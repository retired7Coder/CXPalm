package desktop

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"cxpalm/internal/config"
)

func TestVerifiedStateProtocolsPreserveOwnerAndPatchLineage(t *testing.T) {
	for _, version := range []int{11, 13} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			bridge := NewBridge(config.Config{})
			defer bridge.Close()
			client, peer := net.Pipe()
			defer peer.Close()
			ipc := &IPC{conn: client, closed: make(chan struct{}), events: make(chan Frame, 1)}
			bridge.ipc = ipc
			bridge.sessions["thread"] = &State{ID: "thread"}
			watch := make(chan State, 1)
			bridge.watchers["thread"] = map[chan State]bool{watch: true}
			stopped := make(chan struct{})
			go func() { bridge.events(ipc); close(stopped) }()
			defer func() { close(ipc.events); <-stopped }()
			send := func(protocol int, change map[string]any) State {
				t.Helper()
				ipc.events <- Frame{Method: "thread-stream-state-changed", Version: protocol, Source: "official-owner",
					Params: mustJSON(map[string]any{"hostId": "local", "conversationId": "thread", "change": change})}
				select {
				case state := <-watch:
					return state
				case <-time.After(time.Second):
					t.Fatal("no state update")
					return State{}
				}
			}
			initial := send(version, map[string]any{"type": "snapshot", "revision": 1, "conversationState": map[string]any{
				"id": "thread", "threadRuntimeStatus": map[string]any{"type": "idle"}, "canonicalVoiceHistory": false,
				"turns": []any{map[string]any{"turnId": "turn", "items": []any{map[string]any{"id": "reply", "type": "agentMessage", "text": "Before"}}}},
			}})
			if !initial.Connected || initial.Owner != "official-owner" || initial.Error != "" {
				t.Fatalf("verified protocol rejected: connected=%v error=%s", initial.Connected, initial.Error)
			}
			patched := send(version, map[string]any{"type": "patches", "baseRevision": 1, "revision": 2,
				"patches": []any{map[string]any{"op": "replace", "path": []any{"turns", 0, "items", 0, "text"}, "value": "After"}}})
			if !patched.Connected || !strings.Contains(string(PhoneState(patched).Snapshot), "After") {
				t.Fatal("verified protocol patch was not projected")
			}
			if state, err := bridge.nativeSnapshot("thread"); err != nil || state.Owner != "official-owner" {
				t.Fatal("verified owner unavailable for existing follower controls", err)
			}
			stale := send(version, map[string]any{"type": "patches", "baseRevision": 99, "revision": 3, "patches": []any{}})
			if stale.Connected || stale.Owner != "" || len(stale.Revision) != 0 {
				t.Fatal("invalid patch lineage retained write authority")
			}
			if _, err := bridge.nativeSnapshot("thread"); err == nil {
				t.Fatal("invalid patch lineage remained writable")
			}
			for _, unsupported := range []int{0, 12, 14} {
				restored := send(version, map[string]any{"type": "snapshot", "revision": 3, "conversationState": map[string]any{"id": "thread"}})
				if !restored.Connected || len(restored.Revision) == 0 {
					t.Fatal("fresh verified snapshot did not restore owner authority")
				}
				rejected := send(unsupported, map[string]any{"type": "snapshot", "revision": json.Number("4"), "conversationState": map[string]any{"id": "thread"}})
				if rejected.Connected || rejected.Owner != "" || len(rejected.Revision) != 0 || !strings.Contains(rejected.Error, fmt.Sprint(unsupported)) {
					t.Fatalf("unverified protocol %d did not fail closed with its version", unsupported)
				}
			}
		})
	}
}
