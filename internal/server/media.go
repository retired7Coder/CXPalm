package server

import (
	"crypto/sha256"
	"fmt"
	"net/http"
)

// POST reads keep identities out of URLs; 204 confirms an authorized cached copy.
func mediaUnchanged(w http.ResponseWriter, r *http.Request, data []byte) bool {
	revision := fmt.Sprintf(`"sha256-%x"`, sha256.Sum256(data))
	w.Header().Set("ETag", revision)
	if r.Header.Get("X-CXPalm-Revision") != revision {
		return false
	}
	w.WriteHeader(http.StatusNoContent)
	return true
}
