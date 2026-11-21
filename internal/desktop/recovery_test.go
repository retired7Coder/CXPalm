package desktop

import (
	"context"
	"cxpalm/internal/config"
	"database/sql"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFollowFailureExplainsMissingInterfaceAndNeverGrantsWriteAuthority(t *testing.T) {
	b := NewBridge(config.Config{})
	defer b.Close()
	b.sessions["chat"] = &State{ID: "chat"}
	updates := make(chan State, 4)
	b.watchers["chat"] = map[chan State]bool{updates: true}
	b.recordFollowFailure("chat", &os.PathError{Op: "open", Path: "private-fixture-path", Err: os.ErrNotExist})
	state := <-updates
	if state.Connected || state.Owner != "" || !strings.Contains(state.Error, "兼容性") || strings.Contains(state.Error, "private-fixture-path") {
		t.Fatal("missing interface was hidden, leaked a path, or granted authority", state.Error)
	}
	if _, err := b.nativeSnapshot("chat"); err == nil || err.Error() != state.Error {
		t.Fatal("send did not retain the actual connection reason", err)
	}
	b.recordFollowFailure("chat", os.ErrNotExist)
	select {
	case <-updates:
		t.Fatal("identical retry flooded state updates")
	default:
	}
	b.sessions["chat"].Connected = true
	b.sessions["chat"].Owner = "official-owner"
	b.sessions["chat"].Error = ""
	b.recordFollowFailure("chat", os.ErrNotExist)
	if b.sessions["chat"].Error != "" {
		t.Fatal("late failure replaced a recovered owner state")
	}
}

func TestRecoveryOnlyFollowsDisconnectedWatchedChats(t *testing.T) {
	a, z := net.Pipe()
	defer z.Close()
	b := NewBridge(config.Config{})
	defer b.Close()
	b.ipc = &IPC{conn: a, pending: map[string]chan Frame{}, closed: make(chan struct{}), events: make(chan Frame, 1)}
	b.sessions["lost"] = &State{ID: "lost"}
	b.sessions["live"] = &State{ID: "live", Connected: true, lastNative: time.Now()}
	b.sessions["unused"] = &State{ID: "unused"}
	b.watchers["lost"] = map[chan State]bool{make(chan State, 1): true}
	b.watchers["live"] = map[chan State]bool{make(chan State, 1): true}
	frames := make(chan Frame, 2)
	go func() {
		for {
			f, e := readTestFrame(z)
			if e != nil {
				return
			}
			frames <- f
		}
	}()
	b.recoverStreams()
	select {
	case f := <-frames:
		if f.Method != "thread-stream-following-changed" || string(f.Params) != `{"conversationId":"lost","following":true,"hostId":"local"}` {
			t.Fatalf("unexpected recovery: %+v", f)
		}
	case <-time.After(time.Second):
		t.Fatal("lost subscription was not recovered")
	}
	select {
	case f := <-frames:
		t.Fatalf("unnecessary follow: %+v", f)
	default:
	}
	b.recoverStreams()
	select {
	case f := <-frames:
		t.Fatalf("repeated cold follow without backoff: %+v", f)
	default:
	}
	b.Close()
	if _, e := b.connect(context.Background()); e == nil {
		t.Fatal("closed bridge reconnected")
	}
}

func TestFirstSubscribeSurvivesTemporarilyUnavailableDesktop(t *testing.T) {
	home := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(home, "state_5.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE threads(id TEXT,cwd TEXT,source TEXT,archived INTEGER,updated_at INTEGER); INSERT INTO threads VALUES('chat','.','vscode',0,0);`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	b := NewBridge(config.Config{CodexHome: home, IPCPath: filepath.Join(home, "absent.sock")})
	defer b.Close()
	ctx, done := context.WithTimeout(context.Background(), time.Second)
	defer done()
	states, remove, err := b.Subscribe(ctx, "chat")
	if err != nil {
		t.Fatalf("valid first-click subscription discarded: %v", err)
	}
	defer remove()
	b.mu.Lock()
	watching := len(b.watchers["chat"])
	b.mu.Unlock()
	if watching != 1 {
		t.Fatal("retry has no watcher")
	}
	select {
	case state := <-states:
		if state.Connected {
			t.Fatal("offline desktop presented as live")
		}
	default:
		t.Fatal("no initial state")
	}
	if _, _, err = b.Subscribe(ctx, "not-authorized-chat"); err == nil {
		t.Fatal("unknown chat accepted for recovery")
	}
	remove()
	b.mu.Lock()
	watching = len(b.watchers["chat"])
	b.mu.Unlock()
	if watching != 0 {
		t.Fatal("subscription cancellation leaked watcher")
	}
}

func TestSilentConnectedStreamIsProbedThenLosesWriteAuthority(t *testing.T) {
	a, z := net.Pipe()
	defer z.Close()
	b := NewBridge(config.Config{})
	defer b.Close()
	b.ipc = &IPC{conn: a, pending: map[string]chan Frame{}, closed: make(chan struct{}), events: make(chan Frame, 1)}
	s := &State{ID: "silent", Owner: "original-owner", Connected: true, lastNative: time.Now().Add(-20 * time.Second), lastFollow: time.Now().Add(-time.Minute)}
	b.sessions[s.ID] = s
	b.watchers[s.ID] = map[chan State]bool{make(chan State, 4): true}
	frames := make(chan Frame, 4)
	go func() {
		for {
			f, e := readTestFrame(z)
			if e != nil {
				return
			}
			frames <- f
		}
	}()
	b.recoverStreams()
	select {
	case f := <-frames:
		if f.Method != "thread-stream-following-changed" || len(f.Targets) != 1 || f.Targets[0] != "original-owner" {
			t.Fatal("renewal did not target original owner", f)
		}
	case <-time.After(time.Second):
		t.Fatal("connected-but-silent stream is never probed")
	}
	if !s.Connected {
		t.Fatal("probe falsely invalidated a healthy idle owner")
	}
	b.recoverStreams()
	select {
	case f := <-frames:
		t.Fatal("probe flood", f)
	default:
	}
	b.mu.Lock()
	s.lastFollow = time.Now().Add(-9 * time.Second)
	b.mu.Unlock()
	b.recoverStreams()
	if s.Connected || s.Owner != "" {
		t.Fatal("unanswered native probe retained write authority")
	}
	if _, e := b.nativeSnapshot(s.ID); e == nil {
		t.Fatal("stale owner remained writable")
	}
	select {
	case f := <-frames:
		if len(f.Targets) != 0 {
			t.Fatal("recovery pinned to stale owner")
		}
	case <-time.After(time.Second):
		t.Fatal("lost owner not followed")
	}
}
