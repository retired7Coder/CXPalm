package server

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"mime"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	d, err := s.authorize(r)
	if err != nil {
		http.Error(w, "authorization required", 401)
		return
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(5 * time.Second))
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var q struct {
		Thread string `json:"thread"`
		Turn   string `json:"turn"`
		Item   string `json:"item"`
		File   string `json:"file"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&q) != nil || len(q.File) != 64 {
		http.Error(w, "invalid file identity", 400)
		return
	}
	if _, err := hex.DecodeString(q.File); err != nil {
		http.Error(w, "invalid file identity", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	case <-ctx.Done():
		http.Error(w, "file service busy", 429)
		return
	}
	data, name, err := s.Bridge.File(ctx, q.Thread, q.Turn, q.Item, q.File)
	if err != nil {
		http.Error(w, "referenced file unavailable or outside allowed roots", 404)
		return
	}
	if !s.Store.Valid(d.ID) || !s.Store.IPAllowed(s.clientIP(r)) {
		http.Error(w, "authorization rejected", 401)
		return
	}
	if mediaUnchanged(w, r, data) {
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Write(data)
}
