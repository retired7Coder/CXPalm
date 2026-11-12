package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cxpalm/internal/store"
)

func TestFileHTTPRequiresAuthorizationAndOriginalMessageReference(t *testing.T) {
	s, ts, token := fixture(t)
	data := []byte("synthetic spreadsheet transport")
	if err := os.WriteFile(filepath.Join(s.Config.CodexHome, "review.xlsx"), data, 0600); err != nil {
		t.Fatal(err)
	}
	rollout := filepath.Join(s.Config.CodexHome, "rollout.jsonl")
	event := map[string]any{"type": "response_item", "payload": map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": `:codex-file-citation{path="review.xlsx" purpose="output"}`}}}}
	raw, _ := json.Marshal(event)
	os.WriteFile(rollout, append(raw, '\n'), 0600)
	db, err := sql.Open("sqlite", filepath.Join(s.Config.CodexHome, "state_5.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,source TEXT,archived INTEGER,rollout_path TEXT);INSERT INTO threads VALUES('chat','fixture',?,1,'vscode',1,?)`, s.Config.CodexHome, rollout)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	post := func(origin, bearer string, fields map[string]string, revisions ...string) *http.Response {
		body, _ := json.Marshal(fields)
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/chat/file", bytes.NewReader(body))
		req.Host = "cx.example"
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		if len(revisions) > 0 {
			req.Header.Set("X-CXPalm-Revision", revisions[0])
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response
	}
	q := map[string]string{"thread": "chat", "turn": "history-0", "item": "history-item-0-0", "file": store.Hash("review.xlsx")}
	if post("https://evil.example", token, q).StatusCode != 403 || post("https://cx.example", "", q).StatusCode != 401 {
		t.Fatal("cross-origin or anonymous output read")
	}
	q["path"] = "review.xlsx"
	if post("https://cx.example", token, q).StatusCode != 400 {
		t.Fatal("caller path accepted")
	}
	delete(q, "path")
	q["file"] = strings.Repeat("f", 64)
	if post("https://cx.example", token, q).StatusCode != 404 {
		t.Fatal("unreferenced output read")
	}
	q["file"] = store.Hash("review.xlsx")
	response := post("https://cx.example", token, q)
	body, _ := io.ReadAll(response.Body)
	disposition, params, err := mime.ParseMediaType(response.Header.Get("Content-Disposition"))
	if response.StatusCode != 200 || !bytes.Equal(data, body) || err != nil || disposition != "attachment" || params["filename"] != "review.xlsx" ||
		response.Header.Get("Content-Type") != "application/octet-stream" || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("invalid file response", response.Status, err)
	}
	revision := response.Header.Get("ETag")
	if revision == "" {
		t.Fatal("missing document content revision")
	}
	unchanged := post("https://cx.example", token, q, revision)
	body, _ = io.ReadAll(unchanged.Body)
	if unchanged.StatusCode != 204 || len(body) != 0 || unchanged.Header.Get("ETag") != revision || unchanged.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("unchanged document retransmitted or lost revision")
	}
	path := filepath.Join(s.Config.CodexHome, "review.xlsx")
	updated := bytes.Repeat([]byte("x"), len(data))
	os.WriteFile(path, updated, 0600)
	changed := post("https://cx.example", token, q, revision)
	body, _ = io.ReadAll(changed.Body)
	if changed.StatusCode != 200 || changed.Header.Get("ETag") == revision || !bytes.Equal(body, updated) {
		t.Fatal("same-size document update reused stale bytes")
	}
	os.Remove(path)
	if post("https://cx.example", token, q, revision).StatusCode != 404 {
		t.Fatal("deleted document authorized a cached copy")
	}
	device, _ := s.Store.Authorize(token)
	s.Store.Revoke(device.ID)
	if post("https://cx.example", token, q, revision).StatusCode != 401 {
		t.Fatal("revoked output read")
	}
}
