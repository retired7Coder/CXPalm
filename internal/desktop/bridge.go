package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"cxpalm/internal/attachments"
	"cxpalm/internal/config"
	"cxpalm/internal/store"
)

type State struct {
	listSignal       sessionSignal
	removed          bool
	lastNative       time.Time
	lastFollow       time.Time
	lastOpen         time.Time
	document         *nativeDocument
	ReadToken        string          `json:"readToken,omitempty"`
	NativeSyncedAtMS int64           `json:"nativeSyncedAtMs,omitempty"`
	Archived         bool            `json:"archived"`
	ID               string          `json:"id"`
	Owner            string          `json:"-"`
	Connected        bool            `json:"connected"`
	Revision         json.RawMessage `json:"revision,omitempty"`
	Sequence         uint64          `json:"sequence"`
	Snapshot         json.RawMessage `json:"snapshot,omitempty"`
	Error            string          `json:"error,omitempty"`
}
type Bridge struct {
	Uploads           *attachments.Manager
	historyMu         sync.Mutex
	historyCache      []historyRecord
	queueMu           sync.Mutex
	queueWorkers      map[string]bool
	readContextHint   readContext
	readContextIPC    *IPC
	readContextSource string
	readAttempts      map[string]string
	readRefreshes     map[string]bool
	ReadStore         *store.Store
	readChanges       chan struct{}
	config            config.Config
	History           History
	connectMu         sync.Mutex
	mu                sync.Mutex
	ipc               *IPC
	sessions          map[string]*State
	watchers          map[string]map[chan State]bool
	actions           map[string]*sync.Mutex
	listSyncOnce      sync.Once
	listProgress      SessionSync
	listMembers       map[string]bool
	maintenance       sync.Once
	rollouts          map[string]rolloutSummary
	closeOnce         sync.Once
	done              chan struct{}
	ctx               context.Context
	cancel            context.CancelFunc
	opening           map[string]bool
	following         map[string]bool
}

func NewBridge(c config.Config) *Bridge {
	ctx, cancel := context.WithCancel(context.Background())
	return &Bridge{readChanges: make(chan struct{}), ctx: ctx, cancel: cancel, opening: map[string]bool{}, following: map[string]bool{}, config: c, History: History{c}, sessions: map[string]*State{}, watchers: map[string]map[chan State]bool{}, actions: map[string]*sync.Mutex{}, done: make(chan struct{})}
}
func (b *Bridge) Done() <-chan struct{} { return b.done }
func (b *Bridge) Close() {
	b.closeOnce.Do(func() { b.cancel(); close(b.done) })
	b.mu.Lock()
	c := b.ipc
	b.mu.Unlock()
	if c != nil {
		c.Close()
	}
}
func (b *Bridge) connect(ctx context.Context) (*IPC, error) {
	select {
	case <-b.done:
		return nil, errors.New("bridge closed")
	default:
	}
	b.connectMu.Lock()
	defer b.connectMu.Unlock()
	b.mu.Lock()
	c := b.ipc
	b.mu.Unlock()
	if c != nil {
		select {
		case <-c.Done():
		default:
			return c, nil
		}
	}
	c, e := Connect(ctx, b.config.IPCPath)
	if e != nil {
		return nil, e
	}
	select {
	case <-b.done:
		c.Close()
		return nil, errors.New("bridge closed")
	default:
	}
	b.mu.Lock()
	b.clearReadContextLocked()
	b.ipc = c
	b.mu.Unlock()
	go b.events(c)
	return c, nil
}
func (b *Bridge) emitLocked(s *State) {
	if next := sessionListSignal(*s); next != s.listSignal {
		s.listSignal = next
		b.readChangedLocked()
	}
	s.Sequence++
	for ch := range b.watchers[s.ID] {
		copy := *s
		select {
		case ch <- copy:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- copy:
			default:
			}
		}
	}
}
func (b *Bridge) events(c *IPC) {
	for f := range c.Events() {
		b.mu.Lock()
		stale := b.ipc != nil && b.ipc != c
		b.mu.Unlock()
		if stale {
			continue
		}
		if f.Method == "ipc-connection-reset" {
			b.mu.Lock()
			b.clearReadContextLocked()
			b.readChangedLocked()
			for _, s := range b.sessions {
				s.Connected, s.Owner, s.Revision = false, "", nil
				s.Error = "desktop connection reset; waiting for a fresh owner snapshot"
				b.emitLocked(s)
			}
			b.mu.Unlock()
			continue
		}
		if f.Method == "client-status-changed" {
			var p struct {
				Client string `json:"clientId"`
				Status string `json:"status"`
			}
			if json.Unmarshal(f.Params, &p) == nil && p.Status == "disconnected" {
				b.mu.Lock()
				if b.readContextIPC == c && b.readContextSource == p.Client {
					b.clearReadContextLocked()
					b.readChangedLocked()
					for _, s := range b.sessions {
						b.emitLocked(s)
					}
				}
				for _, s := range b.sessions {
					if s.Owner == p.Client {
						s.Connected = false
						s.Owner = ""
						s.Revision = nil
						s.Error = "desktop owner disconnected"
						b.emitLocked(s)
					}
				}
				b.mu.Unlock()
			}
			continue
		}
		if f.Method == "thread-read-state-changed" && f.Version == 3 {
			b.learnReadContext(c, f)
			continue
		}
		if f.Method != "thread-stream-state-changed" {
			continue
		}
		var p struct {
			Host   string `json:"hostId"`
			ID     string `json:"conversationId"`
			Change struct {
				Type     string          `json:"type"`
				State    json.RawMessage `json:"conversationState"`
				Revision json.RawMessage `json:"revision"`
				Base     json.RawMessage `json:"baseRevision"`
				Patches  json.RawMessage `json:"patches"`
			} `json:"change"`
		}
		if json.Unmarshal(f.Params, &p) != nil || p.Host != "local" {
			continue
		}
		b.mu.Lock()
		s := b.sessions[p.ID]
		if s == nil || s.Archived || s.removed {
			b.mu.Unlock()
			continue
		}
		if f.Version != 11 && f.Version != 13 {
			s.Connected = false
			s.Owner = ""
			s.Revision = nil
			s.Error = fmt.Sprintf("unsupported desktop state protocol %d (supported: 11, 13); update the CXPalm gateway", f.Version)
			b.emitLocked(s)
			b.mu.Unlock()
			continue
		}
		if s.Owner != "" && s.Owner != f.Source {
			b.mu.Unlock()
			continue
		}
		valid := false
		if p.Change.Type == "snapshot" {
			var value map[string]any
			if json.Unmarshal(p.Change.State, &value) == nil && value["id"] == s.ID && f.Source != "" {
				s.Snapshot = p.Change.State
				s.document = &nativeDocument{value: value, encoded: p.Change.State}
				s.Owner = f.Source
				valid = true
			}
		}
		if p.Change.Type == "patches" && s.Connected && string(s.Revision) == string(p.Change.Base) {
			encoded, err := normalizePatches(p.Change.Patches)
			if err == nil {
				next, err := patchDocument(s.snapshotValue(), encoded)
				if err == nil && next["id"] == s.ID {
					s.document = &nativeDocument{value: next}
					s.Snapshot = nil
					valid = true
				}
			}
		}
		if valid {
			s.lastNative = time.Now()
			s.Revision = p.Change.Revision
			s.Connected = true
			s.Error = ""
			unread, known := s.snapshotValue()["hasUnreadTurn"].(bool)
			if known && !unread {
				delete(b.readAttempts, s.ID)
			}
		} else {
			s.Connected = false
			s.Owner = ""
			s.Revision = nil
			s.Error = "desktop state changed; reconnect to request a fresh snapshot"
		}
		b.emitLocked(s)
		b.mu.Unlock()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ipc != c {
		return
	}
	b.clearReadContextLocked()
	b.readChangedLocked()
	for _, s := range b.sessions {
		s.Connected = false
		s.Owner = ""
		s.Error = "desktop disconnected"
		b.emitLocked(s)
	}
}
func (b *Bridge) Subscribe(ctx context.Context, id string) (<-chan State, func(), error) {
	row, e := b.History.Get(ctx, id)
	if e != nil {
		return nil, nil, e
	}
	b.maintenance.Do(func() {
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-b.done:
					return
				case <-ticker.C:
					b.recoverStreams()
				}
			}
		}()
	})
	b.mu.Lock()
	cached := b.sessions[id]
	needPreview := cached == nil || !cached.hasSnapshot() || !cached.Connected
	b.mu.Unlock()
	var preview json.RawMessage
	if needPreview {
		preview = b.historyPreview(ctx, row)
	}
	ch := make(chan State, 4)
	b.mu.Lock()
	s := b.sessions[id]
	if s == nil {
		s = &State{ID: id}
		b.sessions[id] = s
	}
	if b.watchers[id] == nil {
		b.watchers[id] = map[chan State]bool{}
	}
	if !s.hasSnapshot() || (row.Archived && !s.Connected) {
		s.Snapshot = preview
		s.document = nil
	}
	s.Archived = row.Archived
	s.removed = false
	if row.Archived && !s.hasSnapshot() {
		s.Error = "archived history file unavailable; inspect official desktop"
	}
	b.watchers[id][ch] = true
	ch <- *s
	b.mu.Unlock()
	cancel := func() { b.mu.Lock(); delete(b.watchers[id], ch); b.mu.Unlock() }
	if row.Archived {
		return ch, cancel, nil
	}
	// History is ready now. Desktop handshakes must not hold back the first frame.
	b.followAsync(id)
	return ch, cancel, nil
}

func (b *Bridge) followAsync(id string) {
	b.mu.Lock()
	s := b.sessions[id]
	if s == nil || s.Archived || s.removed || s.Connected || len(b.watchers[id]) == 0 || b.following[id] {
		b.mu.Unlock()
		return
	}
	b.following[id] = true
	s.lastFollow = time.Now()
	b.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(b.ctx, 8*time.Second)
		defer cancel()
		c, err := b.connect(ctx)
		b.mu.Lock()
		s := b.sessions[id]
		watching := s != nil && !s.Archived && len(b.watchers[id]) > 0
		b.mu.Unlock()
		if err == nil && watching {
			err = c.Follow(ctx, id, "")
		}
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.following, id)
		if err != nil && s != nil && !s.Connected && !s.Archived && len(b.watchers[id]) > 0 && b.ctx.Err() == nil {
			s.Error = "waiting for official desktop; reconnecting automatically"
			b.emitLocked(s)
		}
	}()
}

// Revalidate silent live subscriptions as well as disconnected ones. Only native
// snapshots/patches renew authority; websocket heartbeats and read overlays do not.
func (b *Bridge) recoverStreams() {
	type renewal struct{ id, owner string }
	b.mu.Lock()
	follows := []renewal{}
	for id, watchers := range b.watchers {
		s := b.sessions[id]
		if len(watchers) == 0 || s.Archived || s.removed || b.following[id] {
			continue
		}
		owner := ""
		if s.Connected {
			if time.Since(s.lastNative) < 15*time.Second {
				continue
			}
			if s.lastFollow.After(s.lastNative) {
				if time.Since(s.lastFollow) < 8*time.Second {
					continue
				}
				s.Connected = false
				s.Owner = ""
				s.Revision = nil
				s.Error = "官方会话状态校验超时，正在重新同步"
				b.emitLocked(s)
			} else {
				owner = s.Owner
			}
		}
		if time.Since(s.lastFollow) < 5*time.Second {
			continue
		}
		s.lastFollow = time.Now()
		b.following[id] = true
		follows = append(follows, renewal{id, owner})
	}
	b.mu.Unlock()
	for _, f := range follows {
		select {
		case <-b.done:
			return
		default:
		}
		ctx, cancel := context.WithTimeout(b.ctx, time.Second)
		c, err := b.connect(ctx)
		if err == nil {
			_ = c.Follow(ctx, f.id, f.owner)
		}
		cancel()
		b.mu.Lock()
		delete(b.following, f.id)
		b.mu.Unlock()
	}
}

func (b *Bridge) Snapshot(id string) (State, error) {
	value, err := b.nativeSnapshot(id)
	if err == nil {
		value.Snapshot = value.snapshotJSON()
	}
	return value, err
}
func (b *Bridge) nativeSnapshot(id string) (State, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	state := b.sessions[id]
	if state == nil || state.removed || state.Archived || !state.Connected || state.Owner == "" {
		return State{}, errors.New("desktop owner not connected; open the chat in official Codex and reconnect")
	}
	return *state, nil
}
func (b *Bridge) Action(ctx context.Context, id, operation, action, text, requestID string, decision json.RawMessage) (any, error) {
	return b.ControlAction(ctx, id, operation, action, text, requestID, decision, Options{}, nil)
}
func (b *Bridge) ControlAction(ctx context.Context, id, operation, action, text, requestID string, decision json.RawMessage, options Options, skillIDs []string) (any, error) {
	return b.ControlActionFiles(ctx, id, operation, action, text, requestID, decision, options, skillIDs, nil)
}
func (b *Bridge) ControlActionFiles(ctx context.Context, id, operation, action, text, requestID string, decision json.RawMessage, options Options, skillIDs []string, files []attachments.File) (any, error) {
	if _, e := b.History.Get(ctx, id); e != nil {
		return nil, e
	}
	b.mu.Lock()
	lock := b.actions[id]
	if lock == nil {
		lock = &sync.Mutex{}
		b.actions[id] = lock
	}
	b.mu.Unlock()
	lock.Lock()
	defer lock.Unlock()
	session, err := b.History.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if session.Archived {
		return nil, errors.New("chat archived; unarchive before continuing")
	}
	s, e := b.nativeSnapshot(id)
	if e != nil {
		return nil, e
	}
	c, e := b.connect(ctx)
	if e != nil {
		return nil, e
	}
	raw := s.snapshotValue()
	if raw == nil {
		return nil, errors.New("invalid native snapshot")
	}
	p := map[string]any{"hostId": "local", "conversationId": id}
	method := ""
	expectedTurn := ""
	switch action {
	case "chat.goal":
		activate, err := b.prepareGoal(ctx, id, text, options, raw)
		if err != nil {
			return nil, err
		}
		if !activate {
			return map[string]any{"applied": true}, nil
		}
		// A metadata client never resumes a thread. Activation goes to its owner.
		input := []any{map[string]any{"type": "text", "text": "请读取本会话当前原生目标，并开始或继续追求该目标；请以原生目标的实际状态报告结果，不要另外创建目标。", "text_elements": []any{}}}
		request := map[string]any{"threadId": id, "input": input, "clientUserMessageId": operation,
			"collaborationMode": map[string]any{"mode": "default", "settings": map[string]any{"model": raw["latestModel"], "reasoning_effort": raw["latestReasoningEffort"], "developer_instructions": nil}}}
		method = "thread-follower-start-turn"
		p["turnStart"] = map[string]any{"request": request, "context": map[string]any{"inheritThreadSettings": true, "attachments": []any{}, "commentAttachments": []any{}}}
	case "chat.send", "chat.steer":
		if (len(text) == 0 && len(files) == 0) || len(text) > 100000 {
			return nil, errors.New("message must contain 1-100000 bytes")
		}
		input := attachments.Input(text, files)
		if len(skillIDs) > 8 {
			return nil, errors.New("一次最多选择 8 个 Skill")
		}
		if len(skillIDs) > 0 {
			session, e := b.History.Get(ctx, id)
			if e != nil {
				return nil, e
			}
			catalog, e := b.Catalog(session.CWD)
			if e != nil {
				return nil, e
			}
			seen := map[string]bool{}
			for _, sid := range skillIDs {
				if seen[sid] {
					return nil, errors.New("重复的 Skill")
				}
				seen[sid] = true
				found := false
				for _, skill := range catalog.Skills {
					if skill.ID == sid {
						input = append(input, map[string]any{"type": "skill", "name": skill.Name, "path": skill.Path})
						found = true
						break
					}
				}
				if !found {
					return nil, errors.New("Skill 已不可用，请刷新目录")
				}
			}
		}
		request := map[string]any{"threadId": id, "input": input, "clientUserMessageId": operation}
		active := false
		if status, ok := raw["threadRuntimeStatus"].(map[string]any); ok {
			active = status["type"] == "active"
		}
		if action == "chat.send" && active {
			return nil, errors.New("thread is active; use steer or wait")
		}
		if action == "chat.steer" && !active {
			return nil, &Rejected{Code: "steer_turn_changed", Message: "引导未发送：当前任务已经结束，请核对会话后手动发送。"}
		}
		if action == "chat.send" {
			method = "thread-follower-start-turn"
			p["turnStart"] = map[string]any{"request": request, "context": map[string]any{"inheritThreadSettings": true, "attachments": []any{}, "commentAttachments": []any{}}}
		} else {
			expectedTurn = activeTurn(raw)
			if expectedTurn == "" || options.ExpectedTurn == "" || expectedTurn != options.ExpectedTurn {
				return nil, &Rejected{Code: "steer_turn_changed", Message: "引导未发送：任务轮次已改变或客户端尚未更新，请刷新当前会话后手动重试。"}
			}
			method = "thread-follower-steer-turn"
			p["input"] = input
			p["clientUserMessageId"] = operation
			p["expectedTurnId"] = expectedTurn
			p["attachments"] = []any{}
			p["restoreMessage"] = map[string]any{"request": request, "context": map[string]any{"attachments": []any{}, "commentAttachments": []any{}}}
		}
	case "chat.settings":
		session, e := b.History.Get(ctx, id)
		if e != nil {
			return nil, e
		}
		catalog, e := b.Catalog(session.CWD)
		if e != nil {
			return nil, e
		}
		settings, e := buildSettings(raw, options, catalog)
		if e != nil {
			return nil, e
		}
		method = "thread-follower-update-thread-settings"
		p["threadSettings"] = settings
		p["activeTurnId"] = nil
		p["condition"] = map[string]any{"ifModelEquals": raw["latestModel"], "ifEffortEquals": raw["latestReasoningEffort"]}
	case "chat.compact":
		if status, ok := raw["threadRuntimeStatus"].(map[string]any); ok && status["type"] == "active" {
			return nil, errors.New("运行中不能压缩上下文，请等待当前任务完成")
		}
		method = "thread-follower-compact-thread"
	case "chat.stop":
		turn := activeTurn(raw)
		if turn == "" {
			return nil, errors.New("no active turn to stop")
		}
		method = "thread-follower-interrupt-turn"
		p["mode"] = "user-stop"
		p["expectedTurnId"] = turn
	case "chat.approve":
		var payload map[string]any
		method, payload, e = approvalAction(raw, id, requestID, decision)
		if e != nil {
			return nil, &Rejected{Code: "approval_not_dispatched", Message: e.Error()}
		}
		for key, value := range payload {
			p[key] = value
		}
	default:
		return nil, errors.New("operation is not allowlisted")
	}
	// Re-check ownership immediately before dispatch; desktop still arbitrates its own concurrency.
	latest, e := b.nativeSnapshot(id)
	if e != nil || latest.Owner != s.Owner {
		if action == "chat.approve" {
			return nil, &Rejected{Code: "approval_owner_changed", Message: "desktop owner changed before approval dispatch; refresh and review again"}
		}
		return nil, errors.New("desktop owner changed before dispatch")
	}
	if action == "chat.approve" {
		if approvalFingerprint(raw, requestID) != approvalFingerprint(latest.snapshotValue(), requestID) {
			return nil, &Rejected{Code: "approval_changed", Message: "approval request changed before dispatch; refresh and review again"}
		}
	}
	var anchor *store.SteerAnchor
	if action == "chat.steer" {
		if activeTurn(latest.snapshotValue()) != expectedTurn {
			return nil, &Rejected{Code: "steer_turn_changed", Message: "引导未发送：任务轮次已改变，请刷新当前会话后手动重试。"}
		}
		anchor = steerAnchor(latest.snapshotValue(), expectedTurn, inputText(attachments.Input(text, files)))
	}
	if options.newChatOnly && (len(orderedTurns(latest.snapshotValue())) > 0 || activeTurn(latest.snapshotValue()) != "") {
		return nil, errors.New("new chat is no longer empty; settings not dispatched")
	}
	callCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	r, e := c.Request(callCtx, method, p, s.Owner)
	if e != nil {
		return nil, e
	}
	if action == "chat.steer" && b.ReadStore != nil {
		if !steerAccepted(r.Result) {
			return nil, errors.New("desktop did not confirm guidance; inspect the original operation before retrying")
		}
		body := inputText(attachments.Input(text, files))
		var acknowledgement map[string]any
		_ = json.Unmarshal(r.Result, &acknowledgement)
		for depth := 0; depth < 5; depth++ {
			if turn, ok := acknowledgement["turnId"].(string); ok && turn != expectedTurn {
				return nil, errors.New("guidance acknowledgement belongs to another turn; inspect desktop")
			}
			next, _ := acknowledgement["result"].(map[string]any)
			if next == nil {
				break
			}
			acknowledgement = next
		}
		images := []string{}
		for _, file := range files {
			if file.Image {
				images = append(images, file.Path)
			}
		}
		if err := b.ReadStore.SaveSteer(id, store.SteerMessage{ID: operation, Turn: expectedTurn, Text: body, Images: images, Anchor: anchor}); err != nil {
			return nil, errors.New("guidance accepted but its display receipt could not be saved; inspect desktop")
		}
		b.NotifyChanged(id)
	}
	return r.Result, nil
}
func fmtID(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		b, _ := json.Marshal(t)
		return string(b)
	}
	return ""
}
func activeTurn(v map[string]any) string {
	turns := orderedTurns(v)
	if len(turns) > 0 {
		for index := len(turns) - 1; index >= 0; index-- {
			if turn, ok := turns[index].(map[string]any); ok && turn["status"] == "inProgress" {
				id := fmtID(turn["turnId"])
				if id == "" {
					id = fmtID(turn["id"])
				}
				return id
			}
		}
		return ""
	}
	if h, ok := v["turnHistory"].(map[string]any); ok {
		if history, ok := h["history"].(map[string]any); ok {
			if entities, ok := history["entitiesByKey"].(map[string]any); ok {
				active := ""
				for _, entry := range entities {
					if t, ok := entry.(map[string]any); ok && t["status"] == "inProgress" {
						if active != "" {
							return ""
						}
						active = fmtID(t["turnId"])
						if active == "" {
							active = fmtID(t["id"])
						}
					}
				}
				return active
			}
		}
	}
	return ""
}
