package dev.cxpalm

import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.animation.core.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import org.json.JSONObject
import androidx.compose.ui.res.painterResource
import io.github.u702165405.cxpalm.R
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.consume
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

fun sessionStatusLabel(value: String): String = when(value) {
    "running" -> tr("进行中"); "completed" -> tr("已完成"); "failed" -> tr("失败"); "interrupted" -> tr("已中断")
    "waiting" -> tr("待确认"); "idle" -> tr("空闲"); else -> tr("状态未知")
}
fun sessionDate(session: JSONObject): String {
    val seconds=session.optLong("lastReplyAt").takeIf { it>0 } ?: session.optLong("updated")
    return if(seconds>0) java.text.SimpleDateFormat("M/dd",java.util.Locale.getDefault()).format(java.util.Date(seconds*1000)) else "—"
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun SessionsPage(state: ViewState, client: BridgeClient) {
    var search by rememberSaveable(state.current?.id) { mutableStateOf(state.sessionSearch) }
    var grouped by rememberSaveable { mutableStateOf(true) }
    var showProjects by rememberSaveable { mutableStateOf(false) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var inheritNewChat by remember(state.current?.id,creating) { mutableStateOf(true) }
    var confirmNewChatFullAccess by remember(state.current?.id,creating,inheritNewChat) { mutableStateOf(false) }
    val newChatDefaults=remember(state.current?.id,creating) { client.savedNewChat() }
    val newChatOptions=newChatDefaults?.optJSONObject("options")
    var unreadOnly by rememberSaveable(state.current?.id) { mutableStateOf(false) }
    var newProject by remember(state.current?.id, creating) { mutableStateOf(state.project.takeIf { it.isNotBlank() } ?: "none") }
    LaunchedEffect(search) { if(search!=state.sessionSearch) { kotlinx.coroutines.delay(250); client.sessionFilter(search=search) } }
    val groups=remember(state.sessions,grouped,unreadOnly,state.archived) { state.sessions.filter { !unreadOnly || state.archived || it.optBoolean("unread") }.groupBy { if(grouped) it.optString("projectId","none") else "" } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom=16.dp), verticalArrangement=Arrangement.spacedBy(8.dp)) {
        item("heading") { Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(tr("会话"), Modifier.weight(1f).padding(top=14.dp), style=MaterialTheme.typography.titleLarge)
            TextButton(onClick={creating=!creating},enabled=state.connected,modifier=Modifier.padding(top=12.dp)) {Text(tr("＋ 新建"))}
            TextButton(onClick=client::refresh,enabled=state.connected,modifier=Modifier.padding(top=12.dp)) {Text(tr("刷新"))}
        } }
        sessionSyncIssue(state.sessionSync,state.connected)?.let { issue ->
            item("sync") { Text(issue,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error) }
        }
        item("scope") { FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(selected=!state.archived&&!unreadOnly,onClick={unreadOnly=false;client.sessionFilter(archived=false)},label={Text(tr("全部"))})
            FilterChip(selected=!state.archived&&unreadOnly,onClick={unreadOnly=true;client.sessionFilter(archived=false)},label={Text(tr("未读"))})
            FilterChip(selected=state.archived,onClick={unreadOnly=false;client.sessionFilter(archived=true)},label={Text(tr("已归档"))})
        } }
        if(unreadOnly&&!state.archived) item("unread-scope") { Text(tr("仅筛选已加载会话，可继续加载更多。"), style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant) }
        item("organization") { FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(selected=grouped,onClick={grouped=!grouped},label={Text(if(grouped) tr("按项目") else tr("按最近"))})
            FilterChip(selected=showProjects||state.project.isNotEmpty(),onClick={showProjects=!showProjects},label={Text(state.projects.firstOrNull { it.optString("id")==state.project }?.optString("name") ?: if(state.project=="none") tr("无项目") else tr("全部项目"))})
        } }
        if(showProjects) item("projects") { FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            FilterChip(selected=state.project=="",onClick={client.sessionFilter(project="");showProjects=false},label={Text(tr("全部项目"))})
            FilterChip(selected=state.project=="none",onClick={client.sessionFilter(project="none");showProjects=false},label={Text(tr("无项目"))})
            state.projects.forEach { p -> FilterChip(selected=state.project==p.optString("id"),onClick={client.sessionFilter(project=p.optString("id"));showProjects=false},label={Text(p.optString("name"))}) }
        } }
        if(creating) item("create") { Surface(shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.primary.copy(alpha=.35f))) {
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(tr("新建会话"),style=MaterialTheme.typography.titleMedium)
                Text(tr("可以选择无项目，使用独立工作目录。创建后自动打开官方桌面，连接成功即可发送消息。"),style=MaterialTheme.typography.bodySmall)
                Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                    Checkbox(checked=inheritNewChat && newChatOptions!=null,onCheckedChange={inheritNewChat=it},enabled=newChatOptions!=null)
                    Text(tr("沿用上次新建会话设置"))
                }
                if(newChatOptions!=null) {
                    Text("${newChatOptions.optString("model")} · ${effortLabel(newChatOptions.optString("effort"))} · ${tr(when(newChatOptions.optString("permission")) { "full" -> "完全访问"; "auto-review" -> "帮我批准"; "workspace" -> "手动批准"; else -> "只读" })}",style=MaterialTheme.typography.bodySmall)
                    Text(tr(when(newChatDefaults.opt("enabled")) { true -> "通知开启"; false -> "通知关闭"; else -> "通知使用默认值" }),style=MaterialTheme.typography.bodySmall)
                } else Text(tr("首次新建使用官方默认设置；连接后会记住本会话的设置。"),style=MaterialTheme.typography.bodySmall)
                Text(tr("只记忆当前电脑在此客户端中新建的会话，不复制审批授权；创建后可在会话中修改。"),style=MaterialTheme.typography.bodySmall)
                if(inheritNewChat && newChatOptions?.optString("permission")=="full") Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                    Checkbox(checked=confirmNewChatFullAccess,onCheckedChange={confirmNewChatFullAccess=it})
                    Text(tr("确认新会话使用完全访问 · 无审批（高风险）"))
                }
                FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)) { FilterChip(selected=newProject=="none",onClick={newProject="none"},label={Text(tr("无项目 · 独立工作目录"))});state.projects.forEach { p -> FilterChip(selected=newProject==p.optString("id"),onClick={newProject=p.optString("id")},label={Text(p.optString("name"))}) } }
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Button(onClick={client.createChat(newProject,inheritNewChat,confirmNewChatFullAccess);creating=false},enabled=state.connected && state.pendingFor(null)==null && newProject.isNotBlank() && !(inheritNewChat && newChatOptions?.optString("permission")=="full" && !confirmNewChatFullAccess)) {Text(tr("创建"))}
                    TextButton(onClick={creating=false}) {Text(tr("取消"))}
                }
            }
        } }
        state.operationNotice(null)?.let { operation -> item("pending") { PendingNotice(operation,state.connected,client) } }
        item("search") {OutlinedTextField(search,{search=it},modifier=Modifier.fillMaxWidth(),placeholder={Text(tr("搜索会话或工作目录"))},singleLine=true,shape=MaterialTheme.shapes.medium,colors=OutlinedTextFieldDefaults.colors(unfocusedContainerColor=MaterialTheme.colorScheme.surface,focusedContainerColor=MaterialTheme.colorScheme.surface,unfocusedBorderColor=MaterialTheme.colorScheme.outlineVariant))}
        groups.forEach { (project,rows) ->
            if(project.isNotEmpty()) item("project:$project") {Text("${rows.first().optString("projectName").ifBlank { tr("无项目") }} · ${rows.size}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(start=4.dp,top=14.dp,bottom=2.dp))}
            itemsIndexed(rows,key={_,session->session.getString("id")}) { _,session ->
                val id=session.getString("id");val status=session.optString("status","unknown");val archived=session.optBoolean("archived")
                Surface(onClick={client.subscribe(id)},enabled=true,shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
                    Column(Modifier.fillMaxWidth().padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                            sessionIndicator(status,if(session.has("unread") && !session.isNull("unread")) session.optBoolean("unread") else null,archived)?.let { SessionStatusDot(it) }
                            Text(session.optString("title").ifBlank { tr("未命名会话") },modifier=Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge,fontWeight=if(session.optBoolean("unread")) androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Normal,maxLines=2,overflow=TextOverflow.Ellipsis,color=if(session.optBoolean("unread")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                            Text(sessionDate(session),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(end=8.dp))
                        }
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                            Text(if(archived) tr("已归档") else (if(session.optString("statusSource")=="history") tr("历史记录")+" · " else "")+sessionStatusLabel(status),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1)
                        }
                    }
                }
            }
        }
        if(state.hasMore) item("more") {TextButton(onClick=client::moreSessions,enabled=state.connected && state.sessionLimit<5000) {Text(if(state.sessionLimit>=5000) tr("已加载 5000 条，请用项目或搜索缩小范围") else tr("加载更多"))}}
        if(groups.values.all { it.isEmpty() }) item("empty") {EmptyState(if(state.archived) tr("没有已归档会话") else tr("没有匹配的会话"),tr("可切换项目、归档范围，或使用其他关键词。"))}
        item("legend") {Text(tr("绿：进行中；蓝：未读；橙：待确认或未读中断；红：未读失败。已读且空闲、状态未同步的会话不显示点。"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    }
}

@OptIn(ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable fun ChatPage(state: ViewState, client: BridgeClient) {
    val context=LocalContext.current
    val attachmentPicker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {uri -> uri?.let(client::upload)}
    val attachments=remember(state.current?.id,state.thread,state.draftRevision) {client.attachmentDraft()}
    val receiveContent=remember(client) {ReceiveContentListener {content -> content.consume {item -> item.uri?.takeIf {it.scheme=="content"}?.let {client.upload(it);true}?:false}}}
    var draftInput by remember(state.current?.id, state.thread) { mutableStateOf(client.draft().let {TextFieldValue(it,TextRange(it.length))}) }
    val draft=draftInput.text
    val inputFocus=remember {FocusRequester()}
    LaunchedEffect(state.draftRevision) { val saved=client.draft();draftInput=TextFieldValue(saved,TextRange(saved.length)) }
    val renderedState=remember(state.current?.id,state.thread) { mutableStateOf(RenderedConversation(emptyList(),emptyMap(),emptySet())) }
    LaunchedEffect(state.current?.id,state.thread,state.historyPage,state.snapshot) {
        val rendered=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { renderConversationData(state.historyPage,state.snapshot) }
        renderedState.value=rendered
    }
    val atLatest=state.historyPage == null || state.historyPage.opt("hasMore") == false
    val messages=renderedState.value.messages
    var questionsOpen by remember(state.current?.id,state.thread) { mutableStateOf(false) }
    val questions=remember(state.historyIndex) { objects(state.historyIndex?.optJSONArray("questions")) }
    var questionPosition by remember(state.current?.id,state.thread) { mutableFloatStateOf(0f) }
    var questionScrubbing by remember { mutableStateOf(false) }
    var questionPending by remember(state.current?.id,state.thread) { mutableStateOf<JSONObject?>(null) }
    val questionList = rememberLazyListState()
    val timings=renderedState.value.timings
    val footerIndices=renderedState.value.footers
    val list = rememberLazyListState()
    val activeQuestion by remember(list, messages, questions, state.historyPage) {
        derivedStateOf {
            val first = list.layoutInfo.visibleItemsInfo.firstNotNullOfOrNull { item -> messages.indexOfFirst { "message:${it.id}" == item.key }.takeIf { it >= 0 } } ?: 0
            activeQuestionIndex(questions, messages, first,
                list.layoutInfo.visibleItemsInfo.isNotEmpty() && !list.canScrollForward, atLatest)
        }
    }
    LaunchedEffect(activeQuestion, questionScrubbing, questionsOpen, questionList.layoutInfo.viewportEndOffset, questionPending) {
        // derivedStateOf can change while awaiting a frame, before this effect
        // is cancelled. Never re-read its index after validating it.
        val target = activeQuestion
        if (target >= 0 && !questionScrubbing && questionPending==null) {
            questionPosition = target.toFloat()
            withFrameNanos { }
            if (target >= questionList.layoutInfo.totalItemsCount) return@LaunchedEffect
            val height=questionList.layoutInfo.viewportEndOffset-questionList.layoutInfo.viewportStartOffset
            val rowHeight=questionList.layoutInfo.visibleItemsInfo.firstOrNull()?.size ?: 32
            questionList.scrollToItem(target, -((height-rowHeight)/2).coerceAtLeast(0))
        }
    }
    val replyIndex = messages.indexOfLast { it.role == "Codex" }
    val reply = messages.getOrNull(replyIndex)
    val latestReplyVisible by remember(list, reply, replyIndex, state.historyPage) {
        derivedStateOf {
            val info = list.layoutInfo
            val item = info.visibleItemsInfo.firstOrNull { it.key == "message:${reply?.id}" }
            atLatest && reply != null && replyBottomReached(replyIndex, list.firstVisibleItemIndex,
                item?.let { it.offset + it.size }, info.viewportEndOffset)
        }
    }
    val showLatest by remember(list,messages,state.historyPage) { derivedStateOf { showLatestContent(messages.isNotEmpty(),state.historyPage?.optBoolean("hasMore")==true,list.canScrollForward) } }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val resumed = lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    LaunchedEffect(state.current?.id, state.thread, state.readToken, state.snapshot, state.historyPage, resumed,renderedState.value) {
        snapshotFlow { resumed && latestReplyVisible && renderedState.value.sourceSnapshot===state.snapshot && renderedState.value.sourcePage===state.historyPage }.collect { reached -> client.markRead(reached) }
    }
    var followLatest by remember(state.current?.id,state.thread) { mutableStateOf(true) }
    var userScrolling by remember(state.current?.id,state.thread) { mutableStateOf(false) }
    LaunchedEffect(list) { snapshotFlow { Triple(list.isScrollInProgress,list.canScrollForward,userScrolling) }.collect { (scrolling,forward,user) ->
        if(user) {followLatest=!forward;if(!scrolling)userScrolling=false}
    } }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    LaunchedEffect(messages,atLatest) {
        if(messages.isNotEmpty() && shouldFollowStream(followLatest,atLatest,dragged,list.isScrollInProgress)) {
            withFrameNanos { }
            if(shouldFollowStream(followLatest,atLatest,dragged,list.isScrollInProgress)) list.scrollToLatestContent()
        }
    }
    val scope = rememberCoroutineScope()
    val active = state.connected && state.desktopConnected && state.snapshot?.optJSONObject("threadRuntimeStatus")?.optString("type") == "active"
    val allowed = state.connected && state.desktopConnected && !state.threadArchived && state.snapshot != null && !state.cached && state.pending == null
    val title = state.sessions.firstOrNull { it.optString("id") == state.thread }?.optString("title").orEmpty().ifBlank { tr("桌面会话") }
    var renaming by remember(state.current?.id,state.thread) { mutableStateOf(false) }
    var renameDraft by remember(state.current?.id,state.thread) { mutableStateOf("") }
    if(renaming) AlertDialog(onDismissRequest={renaming=false},title={Text(tr("重命名会话"))},
        text={OutlinedTextField(renameDraft,{renameDraft=it.take(120)},singleLine=true,label={Text(tr("会话名称"))})},
        confirmButton={TextButton(enabled=renameDraft.isNotBlank()&&state.connected&&state.pending==null,onClick={client.renameChat(renameDraft.trim());renaming=false}) {Text(tr("保存"))}},
        dismissButton={TextButton(onClick={renaming=false}) {Text(tr("取消"))}})
    val header: @Composable () -> Unit = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f).padding(top = 8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(conversationConnectionLabel(state)+(if(active) " · "+tr("Codex 正在工作…") else ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                Text(nativeSyncLabel(state.lastNativeSyncAt),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick={renameDraft=title;renaming=true},enabled=state.connected&&state.pending==null) {
                Icon(painterResource(R.drawable.ic_rename),tr("重命名会话"))
            }
        }
        if(state.threadArchived) NoticeCard(tr("已归档 · 只读历史"),tr("这里可以查看归档正文。请在官方桌面取消归档后继续对话。")) {}
        else if (state.connected && !state.desktopConnected) NoticeCard(tr("等待官方桌面"), tr("请保持电脑上的 Codex 原会话可用。此处不会另开执行器续跑主会话。")) {
            TextButton(onClick = { state.thread?.let(client::subscribe) }) { Text(tr("重新订阅")) }
        }
    }
    var queueInspection by remember(state.current?.id,state.thread) { mutableStateOf<String?>(null) }
    var attachmentMenu by remember(state.current?.id,state.thread) { mutableStateOf(false) }
    queueInspection?.let { id -> AlertDialog(onDismissRequest={queueInspection=null},title={Text(tr("核对排队消息"))},text={Text(tr("请先在官方桌面核对。移除后继续后面的队列，不会撤回已发送的消息，也不会重发本条。"))},confirmButton={TextButton(onClick={client.mutate(state,"chat.queue.cancel",request=id);queueInspection=null}){Text(tr("核对后移除"))}},dismissButton={TextButton(onClick={queueInspection=null}){Text(tr("取消"))}}) }
    val composer: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val requests=objects(state.snapshot?.optJSONArray("requests"))
            if(requests.isNotEmpty()) Column(Modifier.fillMaxWidth().heightIn(max=200.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                requests.forEach { request -> androidx.compose.runtime.key(state.thread,request.toString()) {
                    ApprovalCard(request, allowed) { decision -> client.mutate(state,"chat.approve", request=request.optString("id"),decision=decision) }
                } }
            }
            state.operationNotice(state.thread)?.takeUnless { it.optBoolean("legacy") }?.let { PendingNotice(it,state.connected,client) }
            state.snapshot?.optJSONObject("threadGoal")?.let { goal ->
                Text("${tr("目标模式")} · ${goal.optString("objective")}",maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)
                Row {
                    if(goal.optString("status")=="active") TextButton(onClick={client.goalAction("pause")},enabled=allowed) {Text(tr("暂停目标"))}
                    if(goal.optString("status")=="paused") TextButton(onClick={client.goalAction("resume")},enabled=allowed&&!active) {Text(tr("恢复目标"))}
                    TextButton(onClick={client.goalAction("clear")},enabled=allowed) {Text(tr("关闭目标"))}
                }
            }
            ConversationControls(state, client, allowed)
            val queued = objects(state.snapshot?.optJSONArray("queuedMessages"))
            if(queued.isNotEmpty()) Surface(shape=MaterialTheme.shapes.medium,tonalElevation=2.dp) {
                Column(Modifier.fillMaxWidth().heightIn(max=180.dp).verticalScroll(rememberScrollState()).padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text("${tr("排队消息")} · ${queued.size}",style=MaterialTheme.typography.labelMedium)
                    queued.forEachIndexed { index,item ->
                        val status=item.optString("status")
                        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("${index+1} · ${tr(when(status){"sending"->"正在交给桌面";"sent"->"已发送 · 等待桌面同步";"unknown"->"结果待核对 · 队列暂停";else->"等待发送"})}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.primary)
                                Text(item.optString("text"),maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)
                                if(item.optString("error").isNotBlank()) Text(tr(item.optString("error")),maxLines=2,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error)
                            }
                            if(status=="queued") IconButton(onClick={client.mutate(state,"chat.queue.cancel",request=item.optString("id"))},enabled=allowed) {Text("×",modifier=Modifier.semantics {contentDescription=tr("取消排队消息")})}
                            if(status=="unknown" || status=="sent") TextButton(onClick={queueInspection=item.optString("id")},enabled=allowed) {Text(tr("核对后移除"))}
                        }
                    }
                }
            }
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, shadowElevation = 2.dp,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                    state.upload?.let { transfer ->
                        Column(Modifier.fillMaxWidth().padding(horizontal=8.dp,vertical=6.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(transfer.name,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)
                                    Text(tr(when(transfer.phase) {"cancelled" -> "上传已取消 · 不会自动重试";"failed" -> "上传失败 · 不会自动重试";else -> "正在上传…"}),style=MaterialTheme.typography.labelSmall)
                                }
                                TextButton(onClick={client.cancelUpload(clear=transfer.phase!="uploading")}) {Text(tr(if(transfer.phase=="uploading") "取消上传" else "关闭提示"))}
                            }
                            if(transfer.phase=="uploading") LinearProgressIndicator(Modifier.fillMaxWidth())
                            if(transfer.phase=="cancelled") Text(tr("取消不会删除可能已到达电脑的文件。"),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            transfer.error?.let {Text(tr(it),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error)}
                        }
                    }
                    attachments.forEach {file -> Row(Modifier.fillMaxWidth().padding(horizontal=8.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                        Text("${if(file.optBoolean("image")) "▧" else "↥"} ${file.optString("name")} · ${fileSize(file.optLong("size"))} · ${tr("已上传")}",modifier=Modifier.weight(1f),maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick={client.removeAttachment(file.optString("id"))},enabled=state.pending==null) {Text(tr("移除附件"))}
                    }}
                    TextField(draftInput, { draftInput = it; client.draft(it.text) }, placeholder = { Text(tr("继续这个桌面会话"),maxLines=4,overflow=TextOverflow.Ellipsis) }, modifier = Modifier.fillMaxWidth().contentReceiver(receiveContent).focusRequester(inputFocus), minLines = 1, maxLines = 4,
                        textStyle=MaterialTheme.typography.bodyMedium,
                        colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, disabledContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent))
                    Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                        val attachAllowed=allowed&&!state.uploadBusy&&!state.goalDraft&&attachments.size<8
                        Box {
                            IconButton(onClick={attachmentMenu=true},enabled=attachAllowed) {
                                Icon(painterResource(R.drawable.ic_attach),tr("添加附件"),Modifier.size(22.dp))
                            }
                            DropdownMenu(expanded=attachmentMenu,onDismissRequest={attachmentMenu=false}) {
                                DropdownMenuItem(text={Text(tr(if(state.uploadBusy) "正在上传…" else "图片 / 文件"))},enabled=attachAllowed,
                                    onClick={attachmentMenu=false;attachmentPicker.launch(arrayOf("*/*"))})
                                DropdownMenuItem(text={Text(tr("粘贴图片"))},enabled=attachAllowed,onClick={
                                    attachmentMenu=false
                                    val clipboard=context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                    val uri=clipboard.primaryClip?.let {clip -> (0 until clip.itemCount).mapNotNull {clip.getItemAt(it).uri}.firstOrNull {it.scheme=="content"}}
                                    if(uri!=null)client.upload(uri) else client.reportError("剪贴板没有可读取的图片，请使用图片 / 文件选择器。")
                                })
                            }
                        }
                        if(active) {
                            IconButton(onClick = { client.mutate(state,"chat.stop") }, enabled = allowed) {
                                Icon(painterResource(R.drawable.ic_stop),tr("停止"),Modifier.size(20.dp),tint=MaterialTheme.colorScheme.error)
                            }
                            TextButton(onClick={client.mutate(state,"chat.steer",draft)},enabled=allowed&&!state.uploadBusy&&(draft.isNotBlank()||attachments.isNotEmpty())) {Text(tr("引导"))}
                        }
                        Spacer(Modifier.weight(1f))
                        FilledTonalButton(onClick = { client.mutate(state,messageSendMethod(active,queued.isNotEmpty()), draft) }, enabled = allowed && !state.uploadBusy && !(state.goalDraft&&attachments.isNotEmpty()) && (!(active || queued.isNotEmpty()) || state.snapshot?.optBoolean("queueAvailable")==true) && !((active || queued.isNotEmpty()) && state.goalDraft) && (draft.isNotBlank()||attachments.isNotEmpty()),modifier=Modifier.padding(bottom=4.dp,end=4.dp),contentPadding=PaddingValues(horizontal=12.dp)) {
                            Icon(painterResource(R.drawable.ic_send),null,Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp));Text(tr(if(active || queued.isNotEmpty()) "排队发送" else "发送消息"),maxLines=1)
                        }
                    }
                }
            }
        }
    }
    // Returning from settings restores the reading position; only explicit history navigation repositions it.
    var positioned by rememberSaveable(state.current?.id, state.thread) { mutableStateOf(false) }
    var lastHistoryTarget by rememberSaveable(state.current?.id, state.thread) { mutableStateOf("") }
    val historyTarget = "${state.historyTarget}:${state.sendScrollRevision}"
    LaunchedEffect(state.thread, messages.isNotEmpty(), historyTarget) {
        if(questionPending!=null)return@LaunchedEffect
        if (messages.isNotEmpty() && (!positioned || lastHistoryTarget != historyTarget)) {
            followLatest=state.historyPage==null
            withFrameNanos { }
            if (state.historyPage != null) list.scrollToItem(0)
            else list.scrollToLatestContent()
            positioned = true
            lastHistoryTarget = historyTarget
        }
    }
    LaunchedEffect(state.historyLoading,renderedState.value,questionPending,state.historyTarget) {
        val target=questionPending ?: return@LaunchedEffect
        if(state.historyLoading || renderedState.value.sourcePage!==state.historyPage || renderedState.value.sourceSnapshot!==state.snapshot)return@LaunchedEffect
        val index=questionMessageIndex(target,messages)
        if(index<0) {questionPending=null;return@LaunchedEffect}
        followLatest=false
        withFrameNanos { }
        if(questionPending!==target)return@LaunchedEffect
        list.scrollToItem(1+index+footerIndices.count {it<index})
        positioned=true;lastHistoryTarget=historyTarget;questionPending=null
    }
    val currentState by rememberUpdatedState(state)
    var historyEdgeArmed by remember(state.current?.id,state.thread) { mutableStateOf(true) }
    LaunchedEffect(dragged,state.historyLoading,state.current?.id,state.thread) { if(dragged || !state.historyLoading) historyEdgeArmed=true }
    val historyScroll=remember(list,client,state.current?.id,state.thread) { object : NestedScrollConnection {
        fun loadAtEdge(direction: Float) {
            val current=currentState;val page=current.historyPage ?: current.historyIndex
            if(historyEdgeArmed && current.connected && !current.historyLoading && page!=null) {
                if(direction>0 && list.firstVisibleItemIndex<11 && page.optInt("offset")>0) {
                    historyEdgeArmed=false;client.history(cursor=null,offset=(page.optInt("offset")-20).coerceAtLeast(0),extend=true)
                } else if(direction<0 && !list.canScrollForward && current.historyPage?.optBoolean("hasMore")==true) {
                    historyEdgeArmed=false;client.history(cursor=null,offset=page.optInt("offset")+objects(page.optJSONArray("turns")).size,extend=true)
                }
            }
        }
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if(source==NestedScrollSource.UserInput) {userScrolling=true;if(available.y>0)followLatest=false;loadAtEdge(available.y)}
            return Offset.Zero
        }
        override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
            loadAtEdge(available.y)
            return Velocity.Zero
        }
    } }
    BoxWithConstraints(Modifier.fillMaxSize()) {
      val composerHeight = maxHeight * 0.65f
      Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        header()
        RunningTurnTime(objects(state.snapshot?.optJSONArray("turns")).lastOrNull()?.let(::turnTiming),state.snapshot?.optLong("observedAtMs")?.takeIf { it>0 },
            resumed && state.connected && state.desktopConnected && state.snapshot?.optJSONObject("threadRuntimeStatus")?.optString("type") == "active")
        Box(Modifier.weight(1f)) {
        LazyColumn(Modifier.fillMaxSize().nestedScroll(historyScroll).padding(end=56.dp), state = list, contentPadding = PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (messages.isEmpty()) item("empty") { EmptyState(tr("等待会话内容"), tr("连接后会显示最近的正文与代码。旧历史和完整详情仍可在官方桌面查看。")) }
            item("history-controls") {
                val page=state.historyPage ?: state.historyIndex
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                    TextButton(enabled=state.connected && !state.historyLoading && page?.optInt("offset",1)!=0,onClick={client.history(cursor=null,offset=((page?.optInt("offset") ?: 20)-20).coerceAtLeast(0),extend=true)}) {Text(if(state.historyLoading) tr("正在读取…") else tr("更早的内容"))}
                    if (state.historyPage != null) TextButton(enabled=state.connected && !state.historyLoading,onClick={client.history()}) {Text(tr("回到最新"))}
                }
            }
            itemsIndexed(messages, key = { _, message -> "message:${message.id}" }) { index, message ->
                Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    MessageCard(message,client::item,{message,image -> client.image(state,message,image)},{message,file -> client.file(state,message,file)})
                    if(index in footerIndices) CompletedTurnTime(timings[message.turn])
                }
            }
            if(state.historyPage?.optBoolean("hasMore")==true) item("history-next") {TextButton(enabled=!state.historyLoading,onClick={client.history(cursor=null,offset=state.historyPage.optInt("offset")+objects(state.historyPage.optJSONArray("turns")).size,extend=true)}) {Text(tr("后面的内容"))}}
        }
        if (showLatest) FilledTonalIconButton(
            onClick = {
                userScrolling=false;followLatest=true
                if (state.historyPage != null) client.history()
                else scope.launch { list.scrollToLatestContent() }
            },
            enabled = !state.historyLoading && (state.snapshot!=null || state.connected),
            modifier = Modifier.align(androidx.compose.ui.Alignment.BottomEnd).padding(end = 8.dp, bottom = 8.dp)
        ) { Icon(painterResource(R.drawable.ic_arrow_down), tr("回到最新消息")) }
        if(questions.isNotEmpty()) Surface(modifier=Modifier.align(androidx.compose.ui.Alignment.CenterEnd).padding(bottom=if(showLatest) 56.dp else 0.dp).width(if(questionsOpen) 260.dp else 34.dp).heightIn(max=340.dp),shape=MaterialTheme.shapes.medium,tonalElevation=3.dp,shadowElevation=2.dp) {
            Column(Modifier.padding(3.dp)) {
                TextButton(onClick={questionsOpen=!questionsOpen},contentPadding=PaddingValues(0.dp),modifier=Modifier.fillMaxWidth()) {Text(if(questionsOpen) tr("我的问题")+" ×" else "≡")}
                if(questionsOpen && questions.size>1) Slider(value=questionPosition.coerceIn(0f,(questions.size-1).toFloat()),onValueChange={questionScrubbing=true;questionPosition=it},onValueChangeFinished={
                    questionAtPosition(questions,questionPosition)?.let {question -> questionPending=question;client.history(cursor=question.optString("turn"),item=question.optString("item").takeIf {it.isNotBlank()})}
                    questionScrubbing=false
                },valueRange=0f..(questions.size-1).toFloat(),modifier=Modifier.semantics {contentDescription=tr("滑动定位我的问题")})
                LazyColumn(state=questionList) {itemsIndexed(questions) { index,question ->
                    TextButton(onClick={questionPosition=index.toFloat();questionPending=question;client.history(cursor=question.getString("turn"),item=question.optString("item").takeIf {it.isNotBlank()})},contentPadding=PaddingValues(horizontal=3.dp,vertical=2.dp),modifier=Modifier.fillMaxWidth().background(if(index==activeQuestion) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent,MaterialTheme.shapes.small).semantics {contentDescription=question.optString("text");selected=index==activeQuestion}) {
                        Text(if(questionsOpen) "${index+1}  ${question.optString("text")}" else "${index+1}",maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelSmall,textAlign=if(questionsOpen) TextAlign.Start else TextAlign.Center,modifier=Modifier.fillMaxWidth())
                    }
                }}
            }
        }
        }
        Box(Modifier.heightIn(max = composerHeight).verticalScroll(rememberScrollState())) { composer() }
      }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ConversationControls(state: ViewState, client: BridgeClient, allowed: Boolean) {
    var panel by remember(state.current?.id, state.thread) { mutableStateOf<String?>(null) }
    val snapshot=state.snapshot
    val current=sessionControlValues(snapshot)
    val base=remember(state.current?.id,state.thread,panel) { if(state.goalDraft) current+("mode" to "goal") else current }
    val revision=remember(state.current?.id,state.thread,panel) { snapshot?.optString("controlsRevision").orEmpty() }
    var model by remember(state.current?.id,state.thread,panel) { mutableStateOf(base["model"].orEmpty()) }
    var effort by remember(state.current?.id,state.thread,panel) { mutableStateOf(base["effort"].orEmpty()) }
    var permission by remember(state.current?.id,state.thread,panel) { mutableStateOf(base["permission"].orEmpty()) }
    var mode by remember(state.current?.id,state.thread,panel) { mutableStateOf(base["mode"].orEmpty()) }
    val goalDraft=state.goalDraft
    var confirmFull by remember(state.current?.id,state.thread,panel) { mutableStateOf(false) }
    val permissionLabel=when(current["permission"]) {"read-only" -> tr("只读");"workspace" -> tr("手动批准"); "auto-review" -> tr("帮我批准");"full" -> tr("完全访问 · 无审批");else -> tr("自定义权限")}
    val modelLabel=current["model"].orEmpty().ifBlank { tr("模型未读取") }
    val plan=current["mode"]=="plan"
    val goal=goalDraft || snapshot?.optJSONObject("threadGoal")?.optString("status")=="active"
    val changes=changedControlSettings(base,mapOf("model" to model,"effort" to effort,"permission" to permission,"mode" to mode),panel)
    val usage=remember(snapshot) { contextUsage(snapshot) }
    val running=snapshot?.optJSONObject("threadRuntimeStatus")?.optString("type")=="active"
    var confirmCompact by remember(state.current?.id,state.thread,panel) { mutableStateOf(false) }
    var more by remember(state.current?.id,state.thread) { mutableStateOf(false) }
    val usageColor=if((usage?.percent ?: 0)>=85) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
      FilterChip(selected=panel=="model",onClick={panel=if(panel=="model") null else "model"},enabled=snapshot!=null,modifier=Modifier.weight(1f),
          label={Text(modelLabel,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelSmall)})
      FilterChip(selected = panel == "permission", onClick = { panel = if (panel == "permission") null else "permission" }, enabled = snapshot != null,modifier=Modifier.widthIn(max=112.dp),
          leadingIcon = { Icon(painterResource(R.drawable.ic_shield), null, Modifier.size(16.dp),tint=if(current["permission"]=="full") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) },
          label = {Text(permissionLabel,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelSmall)})
      TextButton(onClick={panel=if(panel=="context") null else "context"},enabled=snapshot!=null,contentPadding=PaddingValues(horizontal=4.dp),
          modifier=Modifier.width(48.dp).semantics {contentDescription=tr("上下文用量")+(usage?.let {" ${it.percent}%"}?:"")}) {
          Text(usage?.let {"${it.percent}%"}?:"—",color=usageColor,style=MaterialTheme.typography.labelSmall)
      }
      val notify=snapshot?.optJSONObject("notificationPreference")?.optBoolean("enabled")==true
      val notifyAvailable=snapshot?.optJSONObject("notificationPreference")?.optBoolean("available",true)!=false
      Box {
        TextButton(onClick={more=true},enabled=snapshot!=null,modifier=Modifier.width(48.dp),contentPadding=PaddingValues(horizontal=4.dp)) {Text(tr("更多"))}
        DropdownMenu(expanded=more,onDismissRequest={more=false}) {
            listOf("plan" to tr("协作模式"),"skill" to "Skill").forEach { (id,label) ->
                DropdownMenuItem(text={Text(label)},onClick={more=false;panel=id},
                    trailingIcon={if(id=="skill") Text(state.skills.size.toString())})
            }
            HorizontalDivider()
            DropdownMenuItem(text={Text(tr(if(!notifyAvailable) "会话通知：暂不可用，正常聊天不受影响" else if(notify) "会话通知：开" else "会话通知：关"))},
                enabled=state.connected&&!state.cached&&state.pending==null&&notifyAvailable,onClick={more=false;client.notifications(!notify)})
        }
      }
    }
    if(plan||goal) Text(tr(if(goal) "目标模式" else "计划模式"),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if (panel != null) Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 200.dp).verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(when (panel) { "model" -> tr("模型与思考深度"); "permission" -> tr("工具权限"); "plan" -> tr("协作模式"); "context" -> tr("上下文用量"); else -> "Skill" }, style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { panel = null }, contentPadding = PaddingValues(0.dp)) { Text(tr("收起")) }
            }
            when (panel) {
                "model" -> {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        objects(state.catalog?.optJSONArray("models")).forEach { entry ->
                            val id = entry.optString("id")
                            FilterChip(selected = model == id, onClick = { model = id; val supported=entry.optJSONArray("efforts"); if(effort!="default" && (0 until (supported?.length() ?: 0)).none { supported!!.getString(it)==effort }) effort="default" }, label = { Text(entry.optString("name", id)) })
                        }
                    }
                    Text(tr("思考深度"), style = MaterialTheme.typography.labelMedium)
                    val selected = objects(state.catalog?.optJSONArray("models")).firstOrNull { it.optString("id") == model }
                    val efforts = selected?.optJSONArray("efforts")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf("default") + (0 until (efforts?.length() ?: 0)).map { efforts!!.getString(it) }).forEach { value ->
                            FilterChip(selected = effort == value, onClick = { effort = value }, label = { Text(effortLabel(value)) })
                        }
                    }
                }
                "permission" -> {
                    Text(tr("仅改变本会话下一轮，不改变正在执行的任务。"), style = MaterialTheme.typography.bodySmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("read-only" to tr("只读"), "auto-review" to tr("帮我批准"), "full" to tr("完全访问")).forEach { (id, label) ->
                            FilterChip(selected = permission == id, onClick = { permission = id; confirmFull = false }, label = { Text(label) })
                        }
                    }
                    if (changes["permission"] == "full") Row {
                        Checkbox(checked = confirmFull, onCheckedChange = { confirmFull = it })
                        Text(tr("我确认完全访问会允许访问整个电脑并关闭审批。"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
                "plan" -> FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("default" to tr("默认模式"), "plan" to tr("计划模式"), "goal" to tr("目标模式")).forEach { (id, label) -> FilterChip(selected = mode == id, onClick = { mode = id }, enabled=id!="goal" || snapshot?.optBoolean("goalAvailable",true)!=false, label = { Text(label) }) }
                }
                "context" -> {
                    if (usage != null) {
                        val numbers = java.text.NumberFormat.getIntegerInstance(AppLanguage.locale)
                        Text(tr("{0} / {1} tokens · {2}%", numbers.format(usage.used), numbers.format(usage.limit), usage.percent), style = MaterialTheme.typography.bodyMedium, color = usageColor)
                        LinearProgressIndicator(progress = { usage.percent / 100f }, modifier = Modifier.fillMaxWidth(), color = usageColor, trackColor = MaterialTheme.colorScheme.outlineVariant)
                    } else Text(tr("官方桌面尚未提供本会话的上下文用量"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(tr("压缩会生成上下文摘要，不会删除聊天历史。任务运行中不可压缩。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (!confirmCompact) OutlinedButton(onClick = { confirmCompact = true }, enabled = allowed && !running) { Text(tr("压缩上下文")) }
                    else {
                        Text(tr("让官方桌面压缩当前会话上下文？这会生成上下文摘要，不是删除聊天历史。"), style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { client.mutate(state,"chat.compact"); confirmCompact = false; panel = null }, enabled = allowed && !running) { Text(tr("确认")) }
                            TextButton(onClick = { confirmCompact = false }) { Text(tr("取消")) }
                        }
                    }
                }
                "skill" -> {
                    val skills = objects(state.catalog?.optJSONArray("skills"))
                    if (skills.isEmpty()) Text(tr("没有可用 Skill，请在电脑安装并启用后刷新。"), style = MaterialTheme.typography.bodySmall)
                    skills.forEach { skill ->
                        Row(Modifier.fillMaxWidth()) {
                            Checkbox(checked = skill.optString("id") in state.skills, onCheckedChange = { client.skill(skill.optString("id"), it) })
                            Column { Text(skill.optString("name")); Text(skill.optString("description"), style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
            }
            if (panel != "skill" && panel != "context") {
                Button(onClick = {
                    val options=JSONObject(changes)
                    if(changes["permission"]=="full") options.put("confirmFullAccess",confirmFull)
                    if(changes["mode"]=="goal") {client.goalMode(true)}
                    else {client.goalMode(false);if(changes["mode"]!=current["mode"] || changes.size>1)client.settings(options,revision)}
                    panel=null
                },enabled=allowed && changes.isNotEmpty() && (changes["permission"]!="full" || confirmFull)) { Text(tr("保存设置")) }
            }
        }
    }
}

@Composable private fun SessionStatusDot(status: String) {
    val color=when(status) {"running" -> Color(0xFF2CA66F);"completed" -> Color(0xFF438BDB);"waiting","interrupted" -> Color(0xFFD99A24);"failed" -> Color(0xFFDF5959);else -> MaterialTheme.colorScheme.onSurfaceVariant}
    val resolver=androidx.compose.ui.platform.LocalContext.current.contentResolver
    val motionEnabled=android.provider.Settings.Global.getFloat(resolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f
    val breathing=motionEnabled && (status=="running" || status=="waiting")
    Box(Modifier.size(18.dp).semantics {contentDescription=sessionStatusLabel(status)},contentAlignment=androidx.compose.ui.Alignment.Center) {
        if(breathing) {
            val transition=rememberInfiniteTransition(label="session status")
            val pulse by transition.animateFloat(initialValue=.65f,targetValue=1.55f,animationSpec=infiniteRepeatable(tween(if(status=="running") 1800 else 2800),RepeatMode.Restart),label="breathing ring")
            Box(Modifier.size(12.dp).graphicsLayer {scaleX=pulse;scaleY=pulse;alpha=(1.55f-pulse)*.65f}.border(1.dp,color,CircleShape))
        }
        Box(Modifier.size(7.dp).then(if(status=="unknown" || status=="interrupted") Modifier.border(1.dp,color,CircleShape) else Modifier.background(color,CircleShape)))
    }
}


private suspend fun LazyListState.scrollToLatestContent() {
    val lastIndex = layoutInfo.totalItemsCount - 1
    if (lastIndex < 0) return
    scrollToItem(lastIndex)
    withFrameNanos { }
    // A single long reply can exceed the viewport; its start is not its bottom.
    val tail = layoutInfo.visibleItemsInfo.lastOrNull { it.index == lastIndex } ?: return
    scrollBy((tail.offset + tail.size - layoutInfo.viewportEndOffset).coerceAtLeast(0).toFloat())
}
