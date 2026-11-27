package desktop

import (
	"fmt"
	"strings"
)

func processPreview(item map[string]any, text, command string) string {
	switch item["type"] {
	case "reasoning", "webSearch", "contextCompaction", "modelChanged":
		return commandPreview(text)
	case "fileChange":
		changes, _ := item["changes"].([]any)
		var paths []string
		for _, entry := range changes {
			if change, ok := entry.(map[string]any); ok {
				if path, ok := change["path"].(string); ok {
					paths = append(paths, path)
				}
			}
		}
		return commandPreview(strings.Join(paths, " · "))
	default:
		return commandPreview(command)
	}
}

// 工具事件使用明确的展示字段，不把完整参数、元数据或内部推理转发到客户端。
func processDisplay(item map[string]any, text, command string) (string, string) {
	if text != "" {
		return text, command
	}
	switch item["type"] {
	case "fileChange":
		changes, _ := item["changes"].([]any)
		var parts []string
		for _, entry := range changes {
			change, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			path, _ := change["path"].(string)
			diff, _ := change["diff"].(string)
			if path != "" {
				parts = append(parts, path)
			}
			if diff != "" {
				parts = append(parts, diff)
			}
		}
		text = strings.Join(parts, "\n\n")
	case "webSearch":
		text, _ = item["query"].(string)
		if text == "" {
			if action, ok := item["action"].(map[string]any); ok {
				text, _ = action["query"].(string)
				if text == "" {
					text = summaryText(action["queries"])
				}
			}
		}
		if text == "" {
			text = "网页搜索"
		}
	case "mcpToolCall":
		server, _ := item["server"].(string)
		tool, _ := item["tool"].(string)
		command = strings.Trim(strings.Join([]string{server, tool}, "."), ".")
		if result, ok := item["result"].(map[string]any); ok {
			contents, _ := result["content"].([]any)
			var parts []string
			for _, entry := range contents {
				part, ok := entry.(map[string]any)
				if ok && part["type"] == "text" {
					if value, ok := part["text"].(string); ok {
						parts = append(parts, value)
					}
				}
			}
			text = strings.Join(parts, "\n")
		}
		if text == "" {
			text = command
		}
	case "automaticApprovalReview":
		text, _ = item["rationale"].(string)
		if action, ok := item["action"].(map[string]any); ok {
			command, _ = action["command"].(string)
		}
		if text == "" {
			text = "自动审批检查"
		}
	case "contextCompaction":
		text = "上下文压缩"
	case "modelChanged":
		from, _ := item["fromModel"].(string)
		to, _ := item["toModel"].(string)
		if to != "" {
			text = fmt.Sprintf("模型切换：%s → %s", from, to)
		}
	}
	return text, command
}
