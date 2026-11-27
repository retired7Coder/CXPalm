package dev.cxpalm

import org.json.JSONObject
import org.json.JSONArray
import java.util.Locale

internal fun activeTurnId(snapshot: JSONObject?): String =
    objects(snapshot?.optJSONArray("turns")).lastOrNull {it.optString("status")=="inProgress"}?.let {it.optString("turnId").ifBlank {it.optString("id")}}.orEmpty()
internal fun composerSourceMatches(source: ViewState, current: ViewState): Boolean =
    source.current!=null && source.current==current.current && source.thread!=null && source.thread==current.thread
internal fun questionMessageIndex(question: JSONObject, messages: List<Message>): Int {
    val turn=question.optString("turn");val item=question.optString("item")
    return messages.indexOfFirst {it.role=="You" && it.turn==turn && (item.isBlank() || it.id=="$turn:$item")}
}

internal fun gatewayConnectionLabel(state: ViewState): String = tr(when {
    state.current == null -> "未登录"
    state.connected -> "网关已连接"
    state.reconnecting -> "正在重连网关"
    state.status.contains("Connecting") -> "正在连接网关"
    else -> "网关未连接"
})
internal fun conversationConnectionLabel(state: ViewState): String = tr(when {
    state.threadArchived -> "已归档·只读"
    !state.connected || state.cached && (state.snapshot != null || state.historyPage != null) -> "离线只读"
    state.pendingFor(state.thread) != null -> "操作待核对"
    state.desktopConnected && state.snapshot != null -> "可发送"
    else -> "正在同步官方桌面"
})
internal fun currentConnectionLabel(state: ViewState): String = gatewayConnectionLabel(state) +
    if(state.thread != null) " · " + conversationConnectionLabel(state) else ""
internal fun desktopConnectionIssue(state: ViewState): String =
    state.status.trim().takeIf { state.connected && !state.desktopConnected &&
        it.isNotBlank() && it !in setOf("Connected", "Desktop connected", "Waiting for desktop") }
        ?: "请保持电脑上的 Codex 原会话可用。此处不会另开执行器续跑主会话。"
internal fun nativeSyncLabel(timestamp: Long): String = if(timestamp > 0)
    tr("最近原桌面同步：{0}",java.text.SimpleDateFormat("MM-dd HH:mm:ss",Locale.getDefault()).format(java.util.Date(timestamp)))
    else tr("原桌面同步时间未知")
internal fun conciseNotice(value: String): String = value.trim().replace(Regex("\\s+")," ").let {if(it.length>160) it.take(159)+"…" else it}

data class ContentPreview(val text: String, val truncated: Boolean)
fun contentPreview(text: String, maxChars: Int = 64000, maxLines: Int = 400, maxColumns: Int = 1000): ContentPreview {
    val out = StringBuilder()
    var truncated = false
    val lines = text.lineSequence().iterator()
    var count = 0
    while (lines.hasNext()) {
        if (count++ >= maxLines) { truncated = true; break }
        val line = lines.next()
        if (count > 1) out.append('\n')
        val room = (maxChars - out.length).coerceAtLeast(0)
        val shown = line.take(minOf(room, maxColumns))
        out.append(shown)
        if (shown.length < line.length) truncated = true
        if (out.length >= maxChars) { truncated = truncated || lines.hasNext(); break }
    }
    return ContentPreview(out.toString(), truncated)
}

fun fileSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024))
    bytes >= 1024 -> String.format(Locale.ROOT, "%.1f KB", bytes / 1024.0)
    else -> "$bytes B"
}

fun approvalDecisions(request: JSONObject): List<String> {
    if(request.optString("method")=="mcpServer/elicitation/request") {
        val params=request.optJSONObject("params") ?: return emptyList()
        val schema=params.optJSONObject("requestedSchema") ?: return emptyList()
        if(params.optString("mode")!="form" || params.optJSONObject("_meta")?.optString("codex_approval_kind")!="mcp_tool_call" || schema.optString("type")!="object" || schema.optJSONObject("properties")?.length()!=0) return emptyList()
        if(schema.keys().asSequence().any {it !in listOf("type","properties","required","title","description")}) return emptyList()
        if(schema.has("required") && schema.optJSONArray("required")?.length()!=0) return emptyList()
        val persist=params.getJSONObject("_meta").opt("persist")
        val session=persist=="session" || persist is JSONArray && (0 until persist.length()).any {persist.opt(it)=="session"}
        return listOf("accept")+(if(session) listOf("acceptForSession") else emptyList())+listOf("decline","cancel")
    }
    if(request.optString("method")=="item/permissions/requestApproval") {
        val permissions=request.optJSONObject("params")?.optJSONObject("permissions") ?: return emptyList()
        return if(permissions.keys().asSequence().all {it in listOf("network","fileSystem")}) listOf("accept","decline") else listOf("decline")
    }
    if(request.optString("method") !in listOf("item/commandExecution/requestApproval","item/fileChange/requestApproval")) return emptyList()
    val params=request.optJSONObject("params")
    if(params?.has("availableDecisions")!=true || params.isNull("availableDecisions")) return listOf("accept","decline")
    val available=params.optJSONArray("availableDecisions") ?: return emptyList()
    return listOf("accept","acceptForSession","decline","cancel").filter { choice -> (0 until available.length()).any {available.opt(it)==choice} }
}

fun approvalSummary(request: JSONObject, missing: String = "请在官方 Codex 桌面查看完整请求。", empty: String = "文件变更或工具请求，请展开详情并核对后再批准。"): String {
    val params = request.optJSONObject("params") ?: return missing
    return listOf("message", "command", "reason", "cwd").mapNotNull { key -> params.opt(key)?.toString()?.takeIf { it.isNotBlank() && it != "null" } }
        .joinToString("\n").take(3000).ifBlank { empty }
}

fun sessionControlValues(snapshot: JSONObject?): Map<String,String> {
    fun value(obj: JSONObject?,key: String)=obj?.opt(key)?.takeUnless { it==JSONObject.NULL }?.toString().orEmpty()
    val settings=snapshot?.optJSONObject("latestThreadSettings") ?: snapshot?.optJSONObject("currentPermissions")
    val profile=value(settings?.optJSONObject("activePermissionProfile"),"id").ifBlank { value(settings,"permissions") }.ifBlank { value(settings?.optJSONObject("sandboxPolicy"),"type") }
    val permission=if(profile in listOf(":workspace","workspace","workspace-write") && value(settings,"approvalsReviewer")=="auto_review") "auto-review" else when(profile) { ":read-only","read-only" -> "read-only"; ":workspace","workspace","workspace-write" -> "workspace"; ":danger-full-access","danger-full-access","full" -> "full";else -> "" }
    return mapOf("model" to value(snapshot,"latestModel").ifBlank { value(settings,"model") },"effort" to value(snapshot,"latestReasoningEffort").ifBlank { value(settings,"effort") }.ifBlank { "default" },"permission" to permission,"mode" to value(snapshot?.optJSONObject("latestCollaborationMode"),"mode").ifBlank { "default" })
}
fun newChatDefaults(snapshot: JSONObject?): JSONObject? {
    val values=sessionControlValues(snapshot)
    val model=values.getValue("model");val effort=values.getValue("effort");val permission=values.getValue("permission")
    if(model.isBlank() || model.length>200 || effort.length>32 || permission !in listOf("read-only","workspace","auto-review","full")) return null
    val defaults=JSONObject().put("options",JSONObject().put("model",model).put("effort",effort).put("permission",permission))
    snapshot?.optJSONObject("notificationPreference")?.let { preference ->
        if(preference.optBoolean("available",true) && preference.opt("enabled") is Boolean) defaults.put("enabled",preference.getBoolean("enabled"))
    }
    return defaults
}
// Same source fields as the Web context ring; absent or zero windows stay unknown.
data class ContextUsage(val used: Long, val limit: Long, val percent: Int)
fun contextUsage(snapshot: JSONObject?): ContextUsage? {
    val info = snapshot?.optJSONObject("latestTokenUsageInfo") ?: return null
    val used = (info.optJSONObject("last")?.opt("inputTokens") as? Number)?.toDouble() ?: return null
    val limit = (info.opt("modelContextWindow") as? Number)?.toDouble() ?: return null
    if (used.isNaN() || limit.isNaN() || limit <= 0) return null
    return ContextUsage(used.toLong(), limit.toLong(), Math.round(used / limit * 100).toInt().coerceIn(0, 100))
}
fun changedControlSettings(base: Map<String,String>,draft: Map<String,String>,group: String?): Map<String,String> {
    val fields=when(group) {"model" -> listOf("model","effort");"permission" -> listOf("permission");"plan" -> listOf("mode");else -> emptyList()}
    return fields.mapNotNull { key -> draft[key]?.takeIf { it.isNotBlank() && it!=base[key] }?.let { key to it } }.toMap()
}


// The single history-controls item precedes non-empty message lists.
fun replyBottomReached(replyIndex: Int, firstVisibleItemIndex: Int, visibleReplyBottom: Int?, viewportEnd: Int): Boolean =
    replyIndex >= 0 && (firstVisibleItemIndex > replyIndex + 1 ||
        visibleReplyBottom != null && visibleReplyBottom <= viewportEnd + 8)

fun showLatestContent(hasMessages: Boolean, showingHistory: Boolean, canScrollForward: Boolean): Boolean =
    hasMessages && (showingHistory || canScrollForward)

fun appBackDestination(page: String): String = if (page == "computers") "settings" else "sessions"

fun activeQuestionIndex(questions: List<JSONObject>, messages: List<Message>, firstMessage: Int, atBottom: Boolean, latest: Boolean): Int {
    if (questions.isEmpty()) return -1
    if (atBottom && latest) return questions.lastIndex
    val users = messages.withIndex().filter { it.value.role == "You" }
    val row = if (atBottom) users.lastOrNull() else users.lastOrNull { it.index <= firstMessage } ?: users.firstOrNull()
    return questions.indexOfFirst {question -> row!=null && questionMessageIndex(question,listOf(row.value))==0}
}

internal fun questionAtPosition(questions: List<JSONObject>, position: Float): JSONObject? =
    if (!position.isFinite() || position < 0) null
    else questions.getOrNull(position.toInt())?.takeIf {it.optString("turn").isNotBlank()}

fun computerConnectionState(state: ViewState, computer: Computer, thread: String?, pending: String?, skills: Set<String>): ViewState {
    val same = state.current?.id == computer.id
    return state.copy(lastNativeSyncAt=if(same && state.thread==thread) state.lastNativeSyncAt else 0,reconnecting=false,upload=null,uploadBusy=false,operationFailures=if(same) state.operationFailures else emptyMap(), current = computer, sessions = if (same) state.sessions else emptyList(), projects = if (same) state.projects else emptyList(),
        archived = same && state.archived, project = if (same) state.project else "", sessionSearch = if (same) state.sessionSearch else "", sessionLimit = if (same) state.sessionLimit else 100,
        threadArchived = same && state.threadArchived, thread = thread, snapshot = if (same) state.snapshot else null, pending = pending, connected = false, desktopConnected = false,
        historyPage = if (same) state.historyPage else null, historyIndex = if (same) state.historyIndex else null, historyLoading = false, historyTarget = if (same) state.historyTarget else null,
        sendUserBefore = if(same) state.sendUserBefore else null, readToken = if (same) state.readToken else "", sharedReadSync = false, sequence = -1, error = null,
        catalog = if (same) state.catalog else null, skills = skills)
}

fun mergeHistoryTurns(before: List<JSONObject>, after: List<JSONObject>): List<JSONObject> {
    val turns = linkedMapOf<String, JSONObject>()
    (before + after).forEach { turns[it.optString("turnId").ifBlank { it.optString("id") }] = it }
    return turns.values.toList()
}
fun extendHistory(current: JSONObject?, page: JSONObject): JSONObject {
    if(current == null) return page
    val earlier=page.optInt("offset") < current.optInt("offset")
    val old=objects(current.optJSONArray("turns")); val fresh=objects(page.optJSONArray("turns"))
    return jsonCopy(page).put("offset", minOf(current.optInt("offset"),page.optInt("offset")))
        .put("hasMore",if(earlier) current.optBoolean("hasMore") else page.optBoolean("hasMore"))
        .put("turns",org.json.JSONArray(if(earlier) mergeHistoryTurns(fresh,old) else mergeHistoryTurns(old,fresh)))
}
fun historyDisplay(page: JSONObject?, snapshot: JSONObject?): JSONObject? = when {
    page == null -> snapshot
    page.optBoolean("hasMore") -> page
    else -> {
        val latest=objects(snapshot?.optJSONArray("turns"))
        val start=((snapshot?.optInt("historyTotal",page.optInt("total")) ?: page.optInt("total"))-latest.size).coerceAtLeast(0)
        val suffix=latest.drop((page.optInt("offset")-start).coerceAtLeast(0))
        jsonCopy(page).put("turns",org.json.JSONArray(mergeHistoryTurns(objects(page.optJSONArray("turns")),suffix)))
    }
}
fun latestUserKey(snapshot: JSONObject?): String = snapshot?.let(::conversationMessages)?.lastOrNull { it.role == "You" }?.let { "${it.id}:${it.text}" }.orEmpty()
fun sentMessageState(state: ViewState): ViewState = if(state.sendUserBefore != null && latestUserKey(state.snapshot) != state.sendUserBefore)
    state.copy(sendUserBefore=null,sendScrollRevision=state.sendScrollRevision+1) else state

fun sessionIndicator(status: String, unread: Boolean?, archived: Boolean = false): String? = when {
    archived -> null
    status == "running" || status == "waiting" -> status
    unread != true -> null
    status == "failed" || status == "interrupted" -> status
    else -> "completed"
}
fun effortLabel(value: String): String = when(value) {
    "default" -> tr("模型默认"); "minimal" -> tr("最少"); "low" -> tr("低")
    "medium" -> tr("中"); "high" -> tr("高"); "xhigh" -> tr("超高"); else -> value
}

fun messageSendMethod(active: Boolean, hasQueue: Boolean): String = if(active || hasQueue) "chat.queue" else "chat.send"

fun seedHistoryIndex(page: JSONObject, snapshot: JSONObject?, indexOnly: Boolean): JSONObject =
    if(indexOnly) page.put("turns",snapshot?.optJSONArray("turns") ?: JSONArray()) else page

internal fun jsonCopy(source: JSONObject): JSONObject = JSONObject().apply {
    source.keys().forEach { key -> put(key, source.opt(key)) }
}

internal fun updatedUnread(snapshot: JSONObject?, unread: Boolean): JSONObject? =
    if(snapshot == null || snapshot.optBoolean("hasUnreadTurn") == unread) snapshot
    else jsonCopy(snapshot).put("hasUnreadTurn", unread)

internal fun shouldFollowStream(following: Boolean, latest: Boolean, dragging: Boolean, scrolling: Boolean): Boolean =
    following && latest && !dragging && !scrolling

internal data class RenderedConversation(val messages: List<Message>, val timings: Map<String,TurnTiming>, val footers: Set<Int>, val sourceSnapshot: JSONObject?=null, val sourcePage: JSONObject?=null)
internal fun renderConversationData(page: JSONObject?, snapshot: JSONObject?): RenderedConversation {
    val display=historyDisplay(page,snapshot)
    val messages=conversationRows(display?.let(::conversationMessages).orEmpty())
    val timings=objects(display?.optJSONArray("turns")).associate { it.optString("turnId").ifBlank { it.optString("id") } to turnTiming(it) }
    return RenderedConversation(messages,timings,timingFooterIndices(messages),snapshot,page)
}

internal fun conversationRows(messages: List<Message>): List<Message> {
    val rows=mutableListOf<Message>()
    val pending=mutableListOf<Message>()
    fun flush() {
        if(pending.isEmpty())return
        val items=pending.toList()
        rows+=Message("process:${items.first().id}","processGroup","",turn=items.first().turn,
            status=if(items.first().turnStatus=="inProgress") "inProgress" else if(items.any {it.status=="failed"}) "failed" else "completed",items=items)
        pending.clear()
    }
    messages.forEach { message ->
        if(pending.isNotEmpty() && pending.first().turn!=message.turn)flush()
        if(message.collapsible || message.phase=="commentary")pending+=message
        else {flush();rows+=message}
    }
    flush()
    return rows
}

internal fun processLabel(role: String): String = tr(when(role) {
    "reasoning" -> "思考摘要"; "commandExecution" -> "执行命令"; "fileChange" -> "文件变更"
    "webSearch" -> "网页搜索"; "mcpToolCall" -> "工具调用"; "automaticApprovalReview" -> "审批检查"
    "contextCompaction" -> "上下文压缩"; "modelChanged" -> "模型切换"; "Codex" -> "进度说明"; else -> "工具详情"
})
internal fun processCounts(items: List<Message>): String =
    items.groupingBy { processLabel(it.role) }.eachCount().entries.joinToString(" · ") {"${it.key} ${it.value}"}

internal fun detailRefreshKey(message: Message): String = if(message.deferred && message.status=="inProgress") "" else message.bodyRevision

internal fun appearanceMode(value: String?): String = value?.takeIf { it in listOf("system", "light", "dark") } ?: "system"
internal fun appearanceIsDark(mode: String, systemDark: Boolean): Boolean = when(appearanceMode(mode)) { "light" -> false; "dark" -> true; else -> systemDark }
