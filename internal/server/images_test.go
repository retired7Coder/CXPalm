package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cxpalm/internal/store"
)

func TestImageHTTPRequiresAuthorizationOriginAndMessageReference(t *testing.T) {
	s, ts, token := fixture(t)
	var imageBytes bytes.Buffer
	png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	imagePath := filepath.Join(s.Config.CodexHome, "returned.png")
	os.WriteFile(imagePath, imageBytes.Bytes(), 0600)
	rollout := filepath.Join(s.Config.CodexHome, "rollout.jsonl")
	event := map[string]any{"type": "response_item", "payload": map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "![result](returned.png)"}}}}
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
	post := func(origin, bearer, id string, revisions ...string) *http.Response {
		body, _ := json.Marshal(map[string]string{"thread": "chat", "turn": "history-0", "item": "history-item-0-0", "image": id})
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/chat/image", bytes.NewReader(body))
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
	id := store.Hash("returned.png")
	if post("https://evil.example", token, id).StatusCode != 403 {
		t.Fatal("cross-origin image read")
	}
	if post("https://cx.example", "", id).StatusCode != 401 {
		t.Fatal("anonymous image read")
	}
	if post("https://cx.example", token, strings.Repeat("f", 64)).StatusCode != 404 {
		t.Fatal("unreferenced image read")
	}
	response := post("https://cx.example", token, id)
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
	data, _ := io.ReadAll(response.Body)
	if !bytes.Equal(data, imageBytes.Bytes()) || response.Header.Get("Content-Type") != "image/png" || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("invalid image response")
	}
	revision := response.Header.Get("ETag")
	if revision == "" {
		t.Fatal("missing image content revision")
	}
	unchanged := post("https://cx.example", token, id, revision)
	body, _ := io.ReadAll(unchanged.Body)
	if unchanged.StatusCode != 204 || len(body) != 0 || unchanged.Header.Get("ETag") != revision || unchanged.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("unchanged image retransmitted or lost revision")
	}
	var replacement bytes.Buffer
	png.Encode(&replacement, image.NewRGBA(image.Rect(0, 0, 3, 3)))
	os.WriteFile(imagePath, replacement.Bytes(), 0600)
	changed := post("https://cx.example", token, id, revision)
	body, _ = io.ReadAll(changed.Body)
	if changed.StatusCode != 200 || changed.Header.Get("ETag") == revision || !bytes.Equal(body, replacement.Bytes()) {
		t.Fatal("same-path image update reused stale bytes")
	}
	os.Remove(imagePath)
	if post("https://cx.example", token, id, revision).StatusCode != 404 {
		t.Fatal("deleted image authorized a cached copy")
	}
	device, _ := s.Store.Authorize(token)
	s.Store.Revoke(device.ID)
	if post("https://cx.example", token, id, revision).StatusCode != 401 {
		t.Fatal("revoked image read")
	}
}
