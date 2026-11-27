package desktop

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProcessProjectionRetainsStructuredActivityAndReplyPhase(t *testing.T) {
	raw := json.RawMessage(`{"turns":[{"turnId":"t","status":"inProgress","items":[
		{"id":"p","type":"agentMessage","phase":"commentary","text":"Checking"},
		{"id":"f","type":"fileChange","status":"completed","changes":[{"path":"main.go","diff":"+fixed"}]},
		{"id":"s","type":"webSearch","action":{"queries":["first","second"]}},
		{"id":"m","type":"mcpToolCall","server":"docs","tool":"read","arguments":{"secret":"PRIVATE_ARGUMENT"},"result":{"content":[{"type":"text","text":"Visible tool output"}],"_meta":{"secret":"PRIVATE_META"}}},
		{"id":"c","type":"commandExecution","command":"git status","cwd":"D:/project","aggregatedOutput":"output","exitCode":0,"durationMs":1200},
		{"id":"r","type":"reasoning","content":[{"text":"PRIVATE_REASONING"}],"encrypted_content":"PRIVATE_ENCRYPTED"},
		{"id":"a","type":"agentMessage","phase":"final_answer","text":"Done"}
	]}]}`)
	state := projectState(State{Snapshot: raw}, true)
	var snapshot map[string]any
	if err := json.Unmarshal(state.Snapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	items := snapshot["turns"].([]any)[0].(map[string]any)["items"].([]any)
	if len(items) != 6 {
		t.Fatalf("lost process items: %s", state.Snapshot)
	}
	progress := items[0].(map[string]any)
	file := items[1].(map[string]any)
	search := items[2].(map[string]any)
	tool := items[3].(map[string]any)
	command := items[4].(map[string]any)
	if progress["phase"] != "commentary" || items[5].(map[string]any)["phase"] != "final_answer" {
		t.Fatal("reply phase was lost")
	}
	if file["preview"] != "main.go" || file["deferred"] != true || file["text"] != "" {
		t.Fatal(file)
	}
	if search["preview"] != "first second" || tool["command"] != "docs.read" || tool["preview"] != "docs.read" {
		t.Fatal("structured tool content was lost")
	}
	if command["cwd"] != "D:/project" || command["exitCode"] != float64(0) || command["durationMs"] != float64(1200) {
		t.Fatal(command)
	}
	full := PhoneState(State{Snapshot: raw})
	if !strings.Contains(string(full.Snapshot), "+fixed") || !strings.Contains(string(full.Snapshot), "Visible tool output") {
		t.Fatal("expanded details were lost")
	}
	if strings.Contains(string(full.Snapshot), "PRIVATE_") || strings.Contains(string(state.Snapshot), "PRIVATE_") {
		t.Fatal("non-display information was forwarded")
	}
}
