package desktop

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"cxpalm/internal/config"
	_ "modernc.org/sqlite"
)

type Session struct {
	Sequence     uint64         `json:"sequence,omitempty"`
	LatestTurn   map[string]any `json:"latestTurn,omitempty"`
	StatusSource string         `json:"statusSource,omitempty"`
	ReadToken    string         `json:"readToken,omitempty"`
	RolloutPath  string         `json:"-"`
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	CWD          string         `json:"cwd"`
	Updated      int64          `json:"updated"`
	Archived     bool           `json:"archived"`
	ProjectID    string         `json:"projectId"`
	ProjectName  string         `json:"projectName"`
	Status       string         `json:"status"`
	Unread       *bool          `json:"unread"`
	LastReplyAt  int64          `json:"lastReplyAt"`
	Live         bool           `json:"live"`
}

var errSessionNotFound = errors.New("desktop session not found")

type History struct{ Config config.Config }

func (h History) database() (*sql.DB, error) {
	paths, e := filepath.Glob(filepath.Join(h.Config.CodexHome, "state_*.sqlite"))
	if e != nil {
		return nil, e
	}
	if len(paths) == 0 {
		return nil, errors.New("official Codex history database not found")
	}
	sort.Slice(paths, func(i, j int) bool {
		a, ea := os.Stat(paths[i])
		b, eb := os.Stat(paths[j])
		return ea == nil && (eb != nil || a.ModTime().After(b.ModTime()))
	})
	// Never open the official database writable or mark a live WAL database immutable.
	p := filepath.ToSlash(paths[0])
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	u := url.URL{Scheme: "file", Path: p, RawQuery: "mode=ro&_pragma=query_only(1)&_pragma=busy_timeout(2000)"}
	db, e := sql.Open("sqlite", u.String())
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
func (h History) List(ctx context.Context, query string, archived bool) ([]Session, error) {
	return h.ListPage(ctx, query, archived, 100, 0)
}
func (h History) ListPage(ctx context.Context, query string, archived bool, limit, offset int) ([]Session, error) {
	if limit < 1 || limit > 500 || offset < 0 {
		return nil, errors.New("limit must be 1-500 and offset must be non-negative")
	}
	return h.list(ctx, query, archived, "", limit, offset)
}
func (h History) list(ctx context.Context, query string, archived bool, id string, limit, offset int) ([]Session, error) {
	db, e := h.database()
	if e != nil {
		return nil, e
	}
	defer db.Close()
	rows, e := db.QueryContext(ctx, "PRAGMA table_info(threads)")
	if e != nil {
		return nil, e
	}
	cols := map[string]bool{}
	for rows.Next() {
		var cid, nn, pk int
		var name, typ string
		var d any
		if e = rows.Scan(&cid, &name, &typ, &nn, &d, &pk); e != nil {
			rows.Close()
			return nil, e
		}
		cols[name] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, s := range []string{"id", "cwd", "source", "archived"} {
		if !cols[s] {
			return nil, fmt.Errorf("unsupported desktop database: missing %s", s)
		}
	}
	title := "''"
	if cols["title"] {
		title = "title"
	}
	if cols["name"] {
		title = "COALESCE(name," + title + ")"
	}
	recency := "0"
	if cols["updated_at"] {
		recency = "updated_at"
	}
	if cols["recency_at"] {
		recency = "COALESCE(recency_at," + recency + ")"
	}
	updated := recency
	if cols["recency_at_ms"] {
		recency = "COALESCE(recency_at_ms," + recency + " * 1000)"
		updated = "CAST((" + recency + ") / 1000 AS INTEGER)"
	}
	rollout := "''"
	if cols["rollout_path"] {
		rollout = "COALESCE(rollout_path,'')"
	}
	filter := "1"
	if cols["originator"] {
		filter = "(originator IN ('Codex Desktop','codex_work_desktop','codex_mobile_bridge','cxpalm') OR (originator IS NULL AND source='vscode'))"
	}
	if cols["thread_source"] {
		filter += " AND COALESCE(thread_source,'')!='subagent'"
	}
	filter += ` AND COALESCE(source,'') NOT LIKE '%"subagent"%'`
	// Match the official interactive list: a named metadata-only stub is not a
	// conversation yet. Exact lookup still permits safe empty-thread creation.
	if id == "" && cols["title"] && cols["first_user_message"] {
		filter += " AND (COALESCE(title,'')!='' OR COALESCE(first_user_message,'')!='')"
	}
	args := []any{archived}
	if id != "" {
		filter += " AND id=?"
		args = append(args, id)
	}
	if query != "" {
		search := []string{}
		for _, field := range []string{"name", "title", "cwd"} {
			if cols[field] {
				search = append(search, field+" LIKE ?")
				args = append(args, "%"+query+"%")
			}
		}
		filter += " AND (" + strings.Join(search, " OR ") + ")"
	}
	args = append(args, limit, offset)
	rows, e = db.QueryContext(ctx, "SELECT id,"+title+",cwd,"+updated+",archived,"+rollout+" FROM threads WHERE archived=? AND "+filter+" ORDER BY "+recency+" DESC, id DESC LIMIT ? OFFSET ?", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var s Session
		var t sql.NullString
		if e = rows.Scan(&s.ID, &t, &s.CWD, &s.Updated, &s.Archived, &s.RolloutPath); e != nil {
			return nil, e
		}
		s.Title = t.String
		out = append(out, s)
	}
	return out, rows.Err()
}
func (h History) Get(ctx context.Context, id string) (Session, error) {
	for _, archived := range []bool{false, true} {
		rows, e := h.list(ctx, "", archived, id, 1, 0)
		if e != nil {
			return Session{}, e
		}
		for _, s := range rows {
			if s.ID == id {
				return s, nil
			}
		}
	}
	return Session{}, errSessionNotFound
}
func (h History) JSON(ctx context.Context) (json.RawMessage, error) {
	s, e := h.List(ctx, "", false)
	if e != nil {
		return nil, e
	}
	b, e := json.Marshal(s)
	return b, e
}
