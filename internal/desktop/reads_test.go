package desktop

import (
	"context"
	"cxpalm/internal/config"
	"cxpalm/internal/store"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readTestContext() readContext {
	return readContext{Identity: map[string]string{"kind": "chatgpt", "accountId": "fixture-account", "userId": "fixture-user"}, HostKey: "local:fixture-host"}
}
func readSnapshot(unread bool, text string) json.RawMessage {
	return mustJSON(map[string]any{"id": "chat", "hasUnreadTurn": unread, "threadRuntimeStatus": map[string]any{"type": "idle"}, "turns": []any{map[string]any{"turnId": "turn", "status": "completed", "items": []any{map[string]any{"type": "agentMessage", "text": text}}}}})
}
func readHint(c readContext, source string) Frame {
	return Frame{Type: "broadcast", Method: "thread-read-state-changed", Version: 3, Source: source, Params: mustJSON(map[string]any{"hostId": "local", "conversationId": "chat", "hasUnreadTurn": false, "context": c})}
}
func readFixture(t *testing.T, hint bool) (*Bridge, *IPC, net.Conn, string) {
	t.Helper()
	root := t.TempDir()
	native, err := sql.Open("sqlite", filepath.Join(root, "state_5.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = native.Exec(`CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,source TEXT,archived INTEGER);INSERT INTO threads VALUES('chat','Example','.',1,'vscode',0)`)
	native.Close()
	if err != nil {
		t.Fatal(err)
	}
	b := NewBridge(config.Config{CodexHome: root})
	db, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	b.ReadStore = db
	client, owner := net.Pipe()
	c := &IPC{conn: client, closed: make(chan struct{}), events: make(chan Frame, 32), clientID: "cxpalm-test"}
	b.ipc = c
	s := &State{ID: "chat", Owner: "original-owner", Connected: true, Snapshot: readSnapshot(true, "reply")}
	b.sessions["chat"] = s
	done := make(chan struct{})
	go func() { b.events(c); close(done) }()
	t.Cleanup(func() {
		owner.Close()
		c.Close()
		close(c.events)
		<-done
		b.Close()
		db.Close()
	})
	if hint {
		b.readContextHint, b.readContextIPC, b.readContextSource = readTestContext(), c, "desktop-coordinator"
	}
	return b, c, owner, readToken(s.snapshotValue())
}
func readFrame(t *testing.T, conn net.Conn) Frame {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	var header [4]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil {
		t.Fatal(err)
	}
	n := binary.LittleEndian.Uint32(header[:])
	if n > 8192 {
		t.Fatal("unexpected read frame size")
	}
	raw := make([]byte, n)
	if _, err := io.ReadFull(conn, raw); err != nil {
		t.Fatal(err)
	}
	var f Frame
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func publishRead(t *testing.T, b *Bridge, c *IPC, source string, unread bool, text string) {
	t.Helper()
	b.mu.Lock()
	seq := b.sessions["chat"].Sequence
	b.mu.Unlock()
	c.events <- Frame{Type: "broadcast", Method: "thread-stream-state-changed", Version: 11, Source: source, Params: mustJSON(map[string]any{"hostId": "local", "conversationId": "chat", "change": map[string]any{"type": "snapshot", "conversationState": json.RawMessage(readSnapshot(unread, text)), "revision": time.Now().UnixNano()}})}
	if source != "original-owner" {
		return
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		ready := b.sessions["chat"].Sequence > seq
		b.mu.Unlock()
		if ready {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("owner snapshot not applied")
}
func readView(t *testing.T, b *Bridge) map[string]any {
	t.Helper()
	b.mu.Lock()
	s := *b.sessions["chat"]
	b.mu.Unlock()
	var raw map[string]any
	if err := json.Unmarshal(b.PhoneState(s).Snapshot, &raw); err != nil {
		t.Fatal(err)
	}
	return raw
}
func assertNoOfficialFiles(t *testing.T, b *Bridge) {
	t.Helper()
	for _, name := range []string{"auth.json", ".codex-global-state.json"} {
		if _, err := os.Stat(filepath.Join(b.config.CodexHome, name)); !os.IsNotExist(err) {
			t.Fatal("official file created", name)
		}
	}
}

func TestDesktopReadConfirmedWithoutAuthFiles(t *testing.T) {
	b, c, owner, token := readFixture(t, true)
	assertNoOfficialFiles(t, b)
	// Old independent receipts must have no authority in either direction.
	if err := b.ReadStore.SetReadToken("chat", token); err != nil {
		t.Fatal(err)
	}
	if readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("old local receipt overrode desktop unread")
	}
	changed := b.ReadChanges()
	one, two := make(chan State, 8), make(chan State, 8)
	b.mu.Lock()
	b.watchers["chat"] = map[chan State]bool{one: true, two: true}
	b.mu.Unlock()
	result := make(chan error, 1)
	go func() {
		ok, err := b.MarkRead(context.Background(), "chat", token)
		if !ok && err == nil {
			err = errors.New("read not accepted")
		}
		result <- err
	}()
	f := readFrame(t, owner)
	var p struct {
		Context readContext `json:"context"`
		Unread  bool        `json:"hasUnreadTurn"`
	}
	json.Unmarshal(f.Params, &p)
	if f.Method != "thread-read-state-changed" || f.Version != 3 || p.Unread || !sameReadContext(p.Context, readTestContext()) {
		t.Fatal("incorrect native read request")
	}
	if readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("write was optimistically accepted")
	}
	// Even a reflected broadcast is not an acknowledgement.
	b.learnReadContext(c, readHint(readTestContext(), "desktop-coordinator"))
	if readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("broadcast changed displayed read state")
	}
	publishRead(t, b, c, "original-owner", false, "reply")
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	for _, ch := range []chan State{one, two} {
		select {
		case s := <-ch:
			var raw map[string]any
			json.Unmarshal(b.PhoneState(s).Snapshot, &raw)
			if raw["hasUnreadTurn"] != false {
				t.Fatal("receiver diverged")
			}
		default:
			t.Fatal("receiver not notified")
		}
	}
	select {
	case <-changed:
	default:
		t.Fatal("list not notified")
	}
	page, err := b.Browse(context.Background(), "", false, "", 10, 0)
	if err != nil || len(page.Items) != 1 || page.Items[0].Unread == nil || *page.Items[0].Unread {
		t.Fatal("list diverged", err)
	}
	b.mu.Lock()
	sequence := b.sessions["chat"].Sequence
	b.mu.Unlock()
	if page.Items[0].Sequence != sequence || sequence == 0 {
		t.Fatal("list read state lost its native sequence")
	}
	if ok, err := b.MarkRead(context.Background(), "chat", token); err != nil || !ok {
		t.Fatal("already-read acknowledgement failed", err)
	}
	publishRead(t, b, c, "original-owner", true, "reply")
	if readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("official manual unread lost")
	}
	// A deliberate new desktop unread event may be read again, not suppressed by an old receipt.
	publishRead(t, b, c, "original-owner", true, "new reply")
	if ok, err := b.MarkRead(context.Background(), "chat", token); err != nil || ok {
		t.Fatal("stale reply accepted", err)
	}
	assertNoOfficialFiles(t, b)
}

func TestReadNeverAcknowledgesUnconfirmedOrChangedAuthority(t *testing.T) {
	for _, mode := range []string{"timeout", "broadcast-only", "wrong-owner", "new-reply", "context-switch", "disconnect"} {
		t.Run(mode, func(t *testing.T) {
			b, c, owner, token := readFixture(t, true)
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
			defer cancel()
			result := make(chan error, 1)
			go func() {
				ok, err := b.MarkRead(ctx, "chat", token)
				if ok {
					result <- errors.New("unconfirmed read accepted")
					return
				}
				if !errors.Is(err, ErrReadSyncUnavailable) {
					result <- errors.New("unavailable status missing")
					return
				}
				result <- nil
			}()
			readFrame(t, owner)
			switch mode {
			case "broadcast-only":
				b.learnReadContext(c, readHint(readTestContext(), "desktop-coordinator"))
			case "wrong-owner":
				publishRead(t, b, c, "different-owner", false, "reply")
			case "new-reply":
				publishRead(t, b, c, "original-owner", true, "new reply")
			case "context-switch":
				next := readTestContext()
				next.Identity["accountId"] = "new-account"
				b.learnReadContext(c, readHint(next, "desktop-coordinator"))
			case "disconnect":
				c.Close()
			}
			if err := <-result; err != nil {
				t.Fatal(err)
			}
			if readView(t, b)["hasUnreadTurn"] != true {
				t.Fatal("unconfirmed read hid unread")
			}
			if stored, err := b.ReadStore.ReadToken("chat"); err != nil || stored != "" {
				t.Fatal("local receipt persisted", err)
			}
			if mode != "new-reply" {
				if ok, err := b.MarkRead(context.Background(), "chat", token); ok || !errors.Is(err, ErrReadSyncUnavailable) {
					t.Fatal("uncertain write was replayed", err)
				}
			}
		})
	}
}

func TestMissingContextAndMalformedFilesDoNotChangeDesktopState(t *testing.T) {
	b, _, _, token := readFixture(t, false)
	for _, name := range []string{"auth.json", ".codex-global-state.json"} {
		if err := os.WriteFile(filepath.Join(b.config.CodexHome, name), []byte("invalid"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("official unread missing")
	}
	if ok, err := b.MarkRead(context.Background(), "chat", token); ok || !errors.Is(err, ErrReadSyncUnavailable) {
		t.Fatal("missing context accepted", err)
	}
	if _, err := b.MarkRead(context.Background(), "chat", strings.Repeat("z", 64)); err == nil {
		t.Fatal("invalid token accepted")
	}
	b.mu.Lock()
	b.sessions["chat"].Archived = true
	b.mu.Unlock()
	if ok, err := b.MarkRead(context.Background(), "chat", token); err != nil || ok {
		t.Fatal("archived read accepted", err)
	}
}

func TestReadContextHintsAreConnectionBoundAndNeverReadState(t *testing.T) {
	for _, mode := range []string{"wrong-version", "self", "missing-source", "invalid-context", "old-connection"} {
		t.Run(mode, func(t *testing.T) {
			b, c, _, _ := readFixture(t, false)
			f := readHint(readTestContext(), "coordinator")
			source := c
			switch mode {
			case "wrong-version":
				f.Version = 2
			case "self":
				f.Source = c.clientID
			case "missing-source":
				f.Source = ""
			case "invalid-context":
				f = readHint(readContext{Identity: map[string]string{"kind": "chatgpt"}, HostKey: "local:fixture"}, "coordinator")
			case "old-connection":
				source = &IPC{clientID: "old"}
			}
			b.learnReadContext(source, f)
			if b.ReadSyncAvailable() {
				t.Fatal("invalid hint enabled writes")
			}
			if readView(t, b)["hasUnreadTurn"] != true {
				t.Fatal("hint changed authority")
			}
		})
	}
}

func TestExecutionStorageContextWithoutAccountFiles(t *testing.T) {
	b, c, _, _ := readFixture(t, false)
	context := readContext{Identity: map[string]string{"kind": "execution-storage", "authMode": "apikey"}, HostKey: "local:fixture-host"}
	b.learnReadContext(c, readHint(context, "desktop-coordinator"))
	if !b.ReadSyncAvailable() || readView(t, b)["hasUnreadTurn"] != true {
		t.Fatal("desktop execution-storage context was rejected or changed read state")
	}
	assertNoOfficialFiles(t, b)
}
