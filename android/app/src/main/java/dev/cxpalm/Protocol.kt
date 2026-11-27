package dev.cxpalm

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

fun normalizeOrigin(value: String): String {
    val u = URI(value.trim())
    require(u.scheme == "https" && !u.host.isNullOrBlank() && u.rawUserInfo == null && u.rawQuery == null && u.rawFragment == null && (u.path.isNullOrEmpty() || u.path == "/")) { "Use an HTTPS root address without credentials or a path" }
    return u.toString().removeSuffix("/")
}
@androidx.compose.runtime.Immutable
data class Message(val id: String, val role: String, val text: String, val truncated: Boolean = false, val turn: String = "", val command: String = "", val status: String = "", val deferred: Boolean = false, val bodyRevision: String = "", val images: List<MessageImage> = emptyList(), val files: List<MessageFile> = emptyList(), val phase: String = "", val turnStatus: String = "", val preview: String = "", val cwd: String = "", val exitCode: Int? = null, val durationMs: Long? = null, val items: List<Message> = emptyList()) {
    val collapsible: Boolean get() = role != "You" && role != "Codex" && role != "sessionError"
}
fun objects(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
// Snapshots are replaced, never mutated after arrival, so identity is a safe cache key.
private object MessageCache {
    private val entries = ArrayDeque<Pair<JSONObject, List<Message>>>()
    @Synchronized fun get(snapshot: JSONObject): List<Message>? = entries.firstOrNull { it.first === snapshot }?.second
    @Synchronized fun put(snapshot: JSONObject, messages: List<Message>) {
        entries.removeAll { it.first === snapshot }; entries.addFirst(snapshot to messages)
        while (entries.size > 4) entries.removeLast()
    }
}
fun conversationMessages(snapshot: JSONObject): List<Message> =
    MessageCache.get(snapshot) ?: parseConversation(snapshot).also { MessageCache.put(snapshot, it) }
private fun parseConversation(snapshot: JSONObject): List<Message> {
    val turns = objects(snapshot.optJSONArray("turns")).ifEmpty {
        val history = snapshot.optJSONObject("turnHistory")?.optJSONObject("history")
        val entities = history?.optJSONObject("entitiesByKey") ?: return@ifEmpty emptyList()
        objects(history.optJSONArray("islands")).flatMap { objects(it.optJSONArray("entries")) }.mapNotNull { entities.optJSONObject(it.optString("value")) }
    }
    return turns.flatMapIndexed { turnIndex, turn ->
        val value = turn.opt("items")
        val items = if (value is JSONArray) objects(value) else {
            val collection = value as? JSONObject
            val entities = collection?.optJSONObject("entitiesByKey")
            objects(collection?.optJSONArray("islands")).flatMap { objects(it.optJSONArray("entries")) }.mapNotNull { entities?.optJSONObject(it.optString("value")) }
        }
        items.mapIndexedNotNull { itemIndex, item ->
            val type = item.optString("type")
            var text = item.optString("text").ifBlank {
                when (val content = if(type == "reasoning") null else item.opt("content")) {
                    is String -> content
                    is JSONArray -> objects(content).mapNotNull { it.optString("text").takeIf(String::isNotBlank) }.joinToString("\n")
                    else -> item.optString("aggregatedOutput").ifBlank { item.optString("command") }
                }
            }
            if (type == "reasoning") {
                val summary = when (val value = item.opt("summary")) {
                    is String -> value
                    is JSONArray -> (0 until value.length()).mapNotNull { index ->
                        when (val part = value.opt(index)) {
                            is String -> part
                            is JSONObject -> part.optString("text").takeIf(String::isNotBlank)
                            else -> null
                        }
                    }.joinToString("\n")
                    else -> ""
                }
                text = summary.ifBlank { text }
            }
            text = text.ifBlank { item.optString("aggregatedOutput").ifBlank { item.optString("command") } }
            val turnId = turn.optString("turnId").ifBlank { turn.optString("id").ifBlank { "turn-$turnIndex" } }
            val itemId = if (item.isNull("id")) "$type:$itemIndex" else item.optString("id").ifBlank { "$type:$itemIndex" }
            val images=objects(item.optJSONArray("images")).mapNotNull {image -> image.optString("id").takeIf {it.matches(Regex("[a-f0-9]{64}"))}?.let {MessageImage(it,image.optString("name"))}}
            val files=objects(item.optJSONArray("files")).mapNotNull {file -> file.optString("id").takeIf {it.matches(Regex("[a-f0-9]{64}"))}?.let {MessageFile(it,file.optString("name"),file.optString("kind"))}}
            if (text.isBlank() && !item.optBoolean("deferred") && images.isEmpty() && files.isEmpty()) null else Message("$turnId:$itemId", if (type == "userMessage") "You" else if (type in listOf("agentMessage","imageGenerationCall","imageGeneration")) "Codex" else type,
                text, item.optBoolean("truncated"), turnId, item.optString("command"), item.optString("status"),item.optBoolean("deferred"),item.optString("bodyRevision"),images,files,
                phase=item.optString("phase"),turnStatus=turn.optString("status"),preview=item.optString("preview"),cwd=item.optString("cwd"),
                exitCode=if(item.opt("exitCode") is Number) item.getInt("exitCode") else null,
                durationMs=if(item.opt("durationMs") is Number) item.getLong("durationMs") else null)
        }
    }
}

// Cached text is retained offline, but is never treated as a live desktop connection.
fun synchronizedChatState(current: ViewState, data: JSONObject): ViewState {
    if (data.optString("id") != current.thread) return current
    val sequence = data.optLong("sequence", -1)
    if (sequence >= 0 && sequence < current.sequence) return current
    val snapshot = data.optJSONObject("snapshot")
    val live = data.optBoolean("connected") && snapshot != null
    return current.copy(readToken = if(snapshot!=null) data.optString("readToken") else current.readToken, snapshot = snapshot ?: current.snapshot, desktopConnected = live, threadArchived = data.optBoolean("archived", current.threadArchived),
        lastNativeSyncAt = data.optLong("nativeSyncedAtMs").takeIf { it > 0 } ?: current.lastNativeSyncAt,
        sequence = maxOf(sequence, current.sequence), status = if (live) "Desktop connected" else data.optString("error", "Waiting for desktop"))
}

// Visibility and exact-reply identity are required; only the gateway confirms shared read state.
fun readReceiptEligible(state: ViewState, foreground: Boolean, latestReplyVisible: Boolean): Boolean =
    foreground && !state.cached && latestReplyVisible && state.sharedReadSync && state.connected && state.desktopConnected &&
    state.thread != null && (state.historyPage == null || state.historyPage.opt("hasMore") == false) && Regex("[a-f0-9]{64}").matches(state.readToken) &&
    state.snapshot?.optBoolean("hasUnreadTurn") == true && state.snapshot.optBoolean("readSyncAvailable",true)

fun sessionSyncIssue(sync: JSONObject?, connected: Boolean): String? =
    if(connected) sync?.optString("error")?.trim()?.takeIf { it.isNotBlank() } else null

fun settlesPending(pending: String?, receipt: JSONObject): Boolean =
    pending != null && pending == receipt.optString("id") && receipt.optString("status") in listOf("confirmed", "acknowledged", "not_sent", "rejected")
