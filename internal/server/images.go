package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

func (s *Server) image(w http.ResponseWriter, r *http.Request) {
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
		Image  string `json:"image"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&q) != nil || len(q.Image) != 64 {
		http.Error(w, "invalid image identity", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	case <-ctx.Done():
		http.Error(w, "image service busy", 429)
		return
	}
	data, mime, err := s.Bridge.Image(ctx, q.Thread, q.Turn, q.Item, q.Image)
	if err != nil {
		http.Error(w, "image unavailable or outside allowed image roots", 404)
		return
	}
	if !s.Store.Valid(d.ID) || !s.Store.IPAllowed(s.clientIP(r)) {
		http.Error(w, "authorization rejected", 401)
		return
	}
	if mediaUnchanged(w, r, data) {
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Write(data)
}
