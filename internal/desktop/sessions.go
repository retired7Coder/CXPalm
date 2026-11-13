package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var errPaging = errors.New("limit must be 1-5000 and offset must be non-negative")

type Project struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Roots []string `json:"-"`
}
type projectMetadata struct {
	Projects map[string]struct {
		ID    string   `json:"id"`
		Name  string   `json:"name"`
		Roots []string `json:"rootPaths"`
	} `json:"local-projects"`
	Assignments map[string]struct {
		Kind string `json:"projectKind"`
		ID   string `json:"projectId"`
	} `json:"thread-project-assignments"`
	Projectless []string `json:"projectless-thread-ids"`
}

func (h History) projects() projectMetadata {
	var m projectMetadata
	if raw, e := readBounded(filepath.Join(h.Config.CodexHome, ".codex-global-state.json"), 16<<20); e == nil {
		_ = json.Unmarshal(raw, &m)
	}
	return m
}
func (m projectMetadata) assign(s *Session) {
	s.Status = "unknown"
	s.ProjectID = "none"
	if a, ok := m.Assignments[s.ID]; ok {
		if a.Kind == "local" || m.Projects[a.ID].Name != "" {
			s.ProjectID = a.ID
			s.ProjectName = m.Projects[a.ID].Name
			if s.ProjectName == "" {
				s.ProjectName = a.ID
			}
		}
		return
	}
	for _, id := range m.Projectless {
		if id == s.ID {
			return
		}
	}
	if isPalmProjectless(s.CWD) {
		return
	}
	// New desktop chats can inherit a project by root without an explicit assignment.
	cwd := projectComparisonPath(s.CWD)
	best := 0
	for id, project := range m.Projects {
		for _, root := range project.Roots {
			root = projectComparisonPath(root)
			if root == "" || cwd == "" || (cwd != root && !strings.HasPrefix(cwd, strings.TrimRight(root, "/")+"/")) {
				continue
			}
			if len(root) > best || (len(root) == best && id < s.ProjectID) {
				best = len(root)
				s.ProjectID, s.ProjectName = id, project.Name
			}
		}
	}
}

// Metadata-only comparison: never resolve or open a project path supplied by a client.
func projectComparisonPath(value string) string {
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, `\`, "/")
	if len(value) >= 8 && strings.EqualFold(value[:8], "//?/UNC/") {
		value = "//" + value[8:]
	} else {
		value = strings.TrimPrefix(value, "//?/")
	}
	windows := strings.HasPrefix(value, "//") || (len(value) >= 3 && value[1] == ':' && value[2] == '/')
	value = path.Clean(value)
	if windows {
		value = strings.ToLower(value)
	}
	return value

}

type SessionPage struct {
	ObservedAtMS int64       `json:"observedAtMs,omitempty"`
	Items        []Session   `json:"items"`
	Projects     []Project   `json:"projects"`
	HasMore      bool        `json:"hasMore"`
	Sync         SessionSync `json:"sync"`
}

// Body-only deltas must not cause catalogue scans on every streamed token.
type sessionSignal struct {
	connected, archived, removed, known, unread, waiting bool
	runtime, timing                                      string
}

func sessionListSignal(s State) sessionSignal {
	raw := s.snapshotValue()
	unread, known := raw["hasUnreadTurn"].(bool)
	runtime, _ := raw["threadRuntimeStatus"].(map[string]any)
	kind, _ := runtime["type"].(string)
	requests, _ := raw["requests"].([]any)
	out := sessionSignal{connected: s.Connected, archived: s.Archived, removed: s.removed,
		known: known, unread: unread, waiting: len(requests) > 0, runtime: kind}
	out.timing = string(mustJSON(latestSessionTurn(raw)))
	return out
}

func latestSessionTurn(raw map[string]any) map[string]any {
	turns := orderedTurns(raw)
	if len(turns) == 0 {
		return nil
	}
	last, ok := turns[len(turns)-1].(map[string]any)
	if !ok {
		return nil
	}
	status, _ := last["status"].(string)
	switch status {
	case "inProgress", "completed", "failed", "interrupted":
	default:
		return nil
	}
	id, _ := last["turnId"].(string)
	out := map[string]any{"status": status, "turnId": id}
	projectTiming(last, out)
	return out
}

func (b *Bridge) Browse(ctx context.Context, query string, archived bool, project string, limit, offset int) (SessionPage, error) {
	out := SessionPage{Items: []Session{}, Projects: []Project{}}
	if limit < 1 || limit > 5000 || offset < 0 {
		return out, errPaging
	}
	m := b.History.projects()
	projects := map[string]Project{}
	for id, p := range m.Projects {
		projects[id] = Project{ID: id, Name: p.Name, Roots: p.Roots}
	}
	// Filter membership before applying pagination, including chats older than 500 rows.
	matched := 0
	for start := 0; ; start += 500 {
		rows, e := b.History.ListPage(ctx, query, archived, 500, start)
		if e != nil {
			return out, e
		}
		for _, s := range rows {
			m.assign(&s)
			if s.ProjectID != "none" {
				projects[s.ProjectID] = Project{ID: s.ProjectID, Name: s.ProjectName}
			}
			if project != "" && project != s.ProjectID {
				continue
			}
			if matched >= offset && len(out.Items) < limit+1 {
				out.Items = append(out.Items, s)
			}
			matched++
		}
		if len(rows) < 500 {
			break
		}
	}
	out.HasMore = len(out.Items) > limit
	if out.HasMore {
		out.Items = out.Items[:limit]
	}
	for i := range out.Items {
		b.replyDate(&out.Items[i])
	}
	states := map[string]State{}
	b.mu.Lock()
	out.Sync = b.listProgress
	for id := range b.listMembers {
		state := b.sessions[id]
		if state != nil && state.Connected && !state.Archived && !state.removed {
			out.Sync.Live++
		}
	}
	for _, row := range out.Items {
		if state := b.sessions[row.ID]; state != nil {
			states[row.ID] = *state
		}
	}
	b.mu.Unlock()
	for i := range out.Items {
		if state, ok := states[out.Items[i].ID]; ok {
			enrichSession(&out.Items[i], state)
		}
	}
	for _, p := range projects {
		out.Projects = append(out.Projects, p)
	}
	sort.Slice(out.Projects, func(i, j int) bool {
		if out.Projects[i].Name == out.Projects[j].Name {
			return out.Projects[i].ID < out.Projects[j].ID
		}
		return out.Projects[i].Name < out.Projects[j].Name
	})
	out.ObservedAtMS = time.Now().UnixMilli()
	return out, nil
}
func enrichSession(row *Session, s State) {
	row.Live = s.Connected
	if s.Connected {
		row.Sequence = s.Sequence
		row.StatusSource = "desktop"
	}
	raw := s.snapshotValue()
	if raw == nil {
		return
	}
	for _, entry := range orderedTurns(raw) {
		turn, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if times, ok := turn["agentMessageCompletedAtMsById"].(map[string]any); ok {
			for _, value := range times {
				if n, ok := value.(float64); ok && int64(n/1000) > row.LastReplyAt {
					row.LastReplyAt = int64(n / 1000)
				}
			}
		}
	}
	row.ReadToken = readToken(raw)
	if !s.Connected {
		return
	}
	row.LatestTurn = latestSessionTurn(raw)
	if unread, ok := raw["hasUnreadTurn"].(bool); ok {
		row.Unread = &unread
	}
	runtime, _ := raw["threadRuntimeStatus"].(map[string]any)
	switch runtime["type"] {
	case "active":
		row.Status = "running"
	case "idle":
		row.Status = "idle"
		turns := orderedTurns(raw)
		if len(turns) > 0 {
			if last, ok := turns[len(turns)-1].(map[string]any); ok {
				switch last["status"] {
				case "completed":
					row.Status = "completed"
				case "failed":
					row.Status = "failed"
				case "interrupted":
					row.Status = "interrupted"
				}
			}
		}
	}
	if requests, ok := raw["requests"].([]any); ok && len(requests) > 0 {
		row.Status = "waiting"
	}
}
