package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// PhoneState is a bounded presentation, never the base for native IPC patches.
func PhoneState(s State) State { return projectState(s, false) }
func projectState(s State, lazy bool) State {
	s.NativeSyncedAtMS = 0
	if !s.lastNative.IsZero() {
		s.NativeSyncedAtMS = s.lastNative.UnixMilli()
	}
	if !s.hasSnapshot() {
		return s
	}
	source := s.snapshotValue()
	s.document = nil
	raw := make(map[string]any, len(source))
	for key, value := range source {
		raw[key] = value
	}
	if source == nil {
		s.Snapshot = nil
		s.Connected = false
		s.Error = "invalid desktop snapshot"
		return s
	}
	s.ReadToken = readToken(raw)
	turns := orderedTurns(raw)
	more := len(turns) > 20
	truncated, _ := raw["historyMore"].(bool)
	historyMore := more || truncated
	if more {
		turns = turns[len(turns)-20:]
	}
	out := []any{}
	for index, entry := range turns {
		turn, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		items := orderedItems(turn["items"])
		messages := []any{}
		errorTexts := map[string]bool{}
		for itemIndex, entry := range items {
			item, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			kind, _ := item["type"].(string)
			if kind == "imageGeneration" {
				kind = "imageGenerationCall"
			}
			text := ""
			if value, ok := item["text"].(string); ok {
				text = value
			}
			if text == "" && kind != "reasoning" {
				switch content := item["content"].(type) {
				case string:
					text = content
				case []any:
					for _, part := range content {
						if p, ok := part.(map[string]any); ok {
							if t, ok := p["text"].(string); ok {
								if text != "" {
									text += "\n"
								}
								text += t
							}
						}
					}
				}
			}
			// 只转发官方桌面公开的思考摘要，不读取内部推理内容。
			if kind == "reasoning" {
				if summary := summaryText(item["summary"]); summary != "" {
					text = summary
				}
			}
			command, _ := item["command"].(string)
			if text == "" {
				text, _ = item["aggregatedOutput"].(string)
			}
			if text == "" {
				text = command
			}
			text, command = processDisplay(item, text, command)
			images := imageReferences(item)
			files := fileReferences(item)
			if kind == "error" || kind == "sessionError" {
				kind = "sessionError"
				if text == "" {
					text = displayError(item["error"])
				}
				if text == "" {
					text, _ = item["message"].(string)
				}
				text = displayError(text)
				command = ""
				images = nil
				if text != "" {
					errorTexts[text] = true
				}
			}
			id, _ := item["id"].(string)
			if id == "" {
				id = fmt.Sprintf("%s:%d", kind, itemIndex)
			}
			if text == "" && len(images) == 0 && len(files) == 0 {
				if problem := displayError(item["error"]); problem != "" && !errorTexts[problem] {
					messages = append(messages, map[string]any{"id": id + ":error", "type": "sessionError", "text": problem, "status": "failed"})
					errorTexts[problem] = true
				}
				continue
			}
			message := map[string]any{"id": id, "type": kind, "text": text, "truncated": false, "status": item["status"], "command": command}
			for _, key := range []string{"phase", "cwd", "exitCode", "durationMs"} {
				if value := item[key]; value != nil {
					message[key] = value
				}
			}
			if kind != "userMessage" && kind != "agentMessage" {
				message["preview"] = processPreview(item, text, command)
			}
			if len(images) > 0 {
				message["images"] = images
			}
			if len(files) > 0 {
				message["files"] = files
				message["text"] = fileDisplayText(text)
			}
			if lazy && kind != "userMessage" && kind != "agentMessage" && kind != "imageGenerationCall" && kind != "sessionError" && (kind != "reasoning" || len(text) > 8192) {
				message["text"] = ""
				message["command"] = commandPreview(command)
				message["deferred"] = true
				message["bodyRevision"] = bodyRevision(text, command)
				message["textBytes"] = len(text)
			}
			messages = append(messages, message)
			if kind != "sessionError" {
				if problem := displayError(item["error"]); problem != "" && !errorTexts[problem] {
					messages = append(messages, map[string]any{"id": id + ":error", "type": "sessionError", "text": problem, "status": "failed"})
					errorTexts[problem] = true
				}
			}
		}
		if problem := turnDisplayError(turn); problem != "" && !errorTexts[problem] && (len(errorTexts) == 0 || displayError(turn["error"]) != "") {
			messages = append(messages, map[string]any{"id": "cxpalm:turn-error", "type": "sessionError", "text": problem, "status": turn["status"]})
		}

		id, _ := turn["turnId"].(string)
		if id == "" {
			id, _ = turn["id"].(string)
		}
		if id == "" {
			id = fmt.Sprintf("turn-%d", len(orderedTurns(raw))-len(turns)+index)
		}
		projected := map[string]any{"turnId": id, "status": turn["status"], "items": messages}
		projectTiming(turn, projected)
		out = append(out, projected)
	}
	projection := map[string]any{"observedAtMs": time.Now().UnixMilli(), "id": s.ID, "turns": out, "historyMore": historyMore, "historyTotal": len(orderedTurns(raw))}
	for _, key := range []string{"historySource", "hasUnreadTurn", "threadRuntimeStatus", "requests", "latestModel", "latestReasoningEffort", "latestTokenUsageInfo", "currentPermissions"} {
		if v, ok := raw[key]; ok {
			projection[key] = v
		}
	}
	projection["controlsRevision"] = ControlsRevision(raw)
	if settings, ok := raw["latestThreadSettings"].(map[string]any); ok {
		out := map[string]any{}
		for _, k := range []string{"model", "effort", "approvalPolicy", "approvalsReviewer", "sandboxPolicy", "permissions", "activePermissionProfile", "serviceTier"} {
			if v, ok := settings[k]; ok {
				out[k] = v
			}
		}
		projection["latestThreadSettings"] = out
	}
	if mode, ok := raw["latestCollaborationMode"].(map[string]any); ok {
		out := map[string]any{"mode": mode["mode"]}
		if settings, ok := mode["settings"].(map[string]any); ok {
			out["settings"] = map[string]any{"model": settings["model"], "reasoning_effort": settings["reasoning_effort"]}
		}
		projection["latestCollaborationMode"] = out
	}
	encoded, e := json.Marshal(projection)
	if e != nil {
		s.Snapshot = nil
		s.Connected = false
		s.Error = "cannot project desktop snapshot"
		return s
	}
	s.Snapshot = encoded
	return s
}
func orderedTurns(raw map[string]any) []any {
	if history, ok := raw["turnHistory"].(map[string]any); ok {
		if h, ok := history["history"].(map[string]any); ok {
			if rows := orderedItems(h); len(rows) > 0 {
				return rows
			}
		}
	}
	if turns, ok := raw["turns"].([]any); ok && len(turns) > 0 {
		return turns
	}
	return nil
}
func orderedItems(value any) []any {
	if rows, ok := value.([]any); ok {
		return rows
	}
	collection, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	entities, ok := collection["entitiesByKey"].(map[string]any)
	if !ok {
		rows, _ := collection["items"].([]any)
		return rows
	}
	islands, _ := collection["islands"].([]any)
	out := []any{}
	for _, island := range islands {
		row, ok := island.(map[string]any)
		if !ok {
			continue
		}
		entries, _ := row["entries"].([]any)
		for _, e := range entries {
			entry, ok := e.(map[string]any)
			if !ok {
				continue
			}
			key, ok := entry["value"].(string)
			if ok {
				if item, ok := entities[key]; ok {
					out = append(out, item)
				}
			}
		}
	}
	return out
}

// Fingerprint the latest reply, not transport revisions, settings or tool output.
// This is a viewing receipt, never a write to the official desktop's read state.
func readToken(raw map[string]any) string {
	turns := orderedTurns(raw)
	if len(turns) == 0 {
		return ""
	}
	turn, ok := turns[len(turns)-1].(map[string]any)
	if !ok {
		return ""
	}
	messages := []any{}
	for _, entry := range orderedItems(turn["items"]) {
		item, ok := entry.(map[string]any)
		if ok && item["type"] == "agentMessage" {
			messages = append(messages, map[string]any{"id": item["id"], "text": item["text"], "content": item["content"], "status": item["status"]})
		}
	}
	if len(messages) == 0 {
		return ""
	}
	encoded, err := json.Marshal(map[string]any{"id": raw["id"], "turnId": turn["turnId"], "idFallback": turn["id"], "status": turn["status"], "completed": turn["agentMessageCompletedAtMsById"], "messages": messages})
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func summaryText(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case []any:
		parts := []string{}
		for _, part := range value {
			text, _ := part.(string)
			if object, ok := part.(map[string]any); ok {
				text, _ = object["text"].(string)
			}
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}
