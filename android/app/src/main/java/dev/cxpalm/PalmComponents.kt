package dev.cxpalm

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import io.github.u702165405.cxpalm.R

@Composable fun SectionTitle(title: String, subtitle: String? = null) {
    Column(Modifier.padding(top = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun EmptyState(title: String, text: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun NoticeCard(title: String, text: String, error: Boolean = false, actions: @Composable ColumnScope.() -> Unit = {}) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(text, style = MaterialTheme.typography.bodyMedium)
            actions()
        }
    }
}

@Composable fun RawDetails(text: String) {
    var expanded by remember(text) { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) tr("收起原始详情") else tr("展开原始详情")) }
    if (expanded) CodeText(text.take(32000))
}

@Composable fun CodeText(text: String, language: String = "", diff: Boolean = false) {
    val preview = remember(text) { ContentPreview(text,false) }
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.small).padding(12.dp)) {
        if (language.isNotBlank()) Text(language, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 6.dp))
        SelectionContainer {
            if (diff) {
                val styled = buildAnnotatedString { preview.text.lineSequence().forEach { line ->
                    withStyle(SpanStyle(color = when {
                        line.startsWith('+') -> MaterialTheme.colorScheme.primary
                        line.startsWith('-') -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    })) { append(line); append('\n') }
                } }
                Text(styled, Modifier.horizontalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            } else Text(preview.text, modifier = Modifier.horizontalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium)
        }
        if (preview.truncated) Text(tr("长代码已限制行数或列宽，完整内容请在电脑查看。"), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable fun MessageCard(message: Message, loadBody: suspend (Message)->Message, loadImage: suspend (Message,MessageImage)->ByteArray, loadFile: suspend (Message,MessageFile)->ByteArray = {_,_ -> error("File download unavailable")}, initiallyExpanded: Boolean = false) {
    val you = message.role == "You"
    val problem = message.role == "sessionError"
    var expanded by rememberSaveable(message.id) { mutableStateOf(initiallyExpanded) }
    var detail by remember(message.id) { mutableStateOf<Message?>(null) }
    var loading by remember(message.id) { mutableStateOf(false) }
    var failed by remember(message.id) { mutableStateOf(false) }
    var retry by remember(message.id) { mutableIntStateOf(0) }
    LaunchedEffect(expanded,message.id,detailRefreshKey(message),message.status,retry) {
        if(expanded && message.deferred && detail?.bodyRevision!=message.bodyRevision) {
            loading=true;failed=false
            try { detail=loadBody(message) }
            catch(cancelled:kotlinx.coroutines.CancellationException) {throw cancelled}
            catch(_:Exception) {failed=true}
            finally {loading=false}
        }
    }
    val content=if(message.deferred) detail else message
    val label = when (message.role) {
        "You" -> tr("你"); "Codex" -> if(message.phase=="commentary") tr("进度说明") else "CODEX"
        "sessionError" -> tr("本轮提示"); else -> processLabel(message.role)
    }
    val status = when (message.status) {
        "inProgress" -> tr("进行中"); "completed" -> tr("已完成"); "failed" -> tr("失败"); "declined" -> tr("已拒绝"); else -> ""
    }
    val expansion = if (expanded) tr("已展开") else tr("已折叠")
    // 用户消息靠右，回答直接排版，工具详情按需展开。
    Box(Modifier.fillMaxWidth(), contentAlignment = if (you) Alignment.CenterEnd else Alignment.CenterStart) {
    Surface(modifier = if (you) Modifier.fillMaxWidth(0.88f).wrapContentWidth(Alignment.End) else Modifier.fillMaxWidth(),
        color = when { problem -> MaterialTheme.colorScheme.errorContainer; you -> MaterialTheme.colorScheme.primaryContainer; message.collapsible -> MaterialTheme.colorScheme.surface; else -> Color.Transparent },
        contentColor = if (problem) MaterialTheme.colorScheme.onErrorContainer else if (you) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
        shape = if (you) RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp) else MaterialTheme.shapes.medium,
        border = if (message.collapsible) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null) {
        Column(if (you) Modifier else Modifier.fillMaxWidth()) {
            if (message.collapsible) {
                Row(Modifier.fillMaxWidth().semantics { stateDescription = expansion }
                    .clickable(role = Role.Button) { expanded = !expanded }.heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(label, style = MaterialTheme.typography.labelMedium)
                    if (message.command.isNotBlank()) Text(message.command.replace(Regex("\\s+"), " ").trim(), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else Text(message.preview.ifBlank {message.text}.replace(Regex("\\s+")," ").trim(), Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if (status.isNotBlank()) Surface(shape = CircleShape, color = if (message.status == "failed") MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
                        Text(status, Modifier.padding(horizontal = 8.dp, vertical = 1.dp), style = MaterialTheme.typography.bodySmall, color = if (message.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (!message.collapsible || expanded) {
                Column((if (you) Modifier else Modifier.fillMaxWidth()).padding(
                    horizontal = if (message.collapsible || you || problem) 14.dp else 2.dp,
                    vertical = if (you || problem) 10.dp else if (message.collapsible) 12.dp else 4.dp), verticalArrangement = Arrangement.spacedBy(if (you) 2.dp else 8.dp)) {
                    if (!message.collapsible) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!you) Box(Modifier.size(18.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                            Text(if(problem) "!" else "‹›", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelSmall)
                        }
                        Text(label, style = MaterialTheme.typography.labelMedium, color = if (you) MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = .65f) else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if(loading) Text(tr("正在读取…"),style=MaterialTheme.typography.bodySmall)
                    if(failed) TextButton(onClick={retry++}) {Text(tr("读取失败，点击重试"))}
                    else if(message.deferred) TextButton(onClick={retry++},enabled=!loading) {Text(tr("刷新输出"))}
                    val metadata=listOfNotNull(message.cwd.takeIf {it.isNotBlank()},message.exitCode?.let {"${tr("退出码")} $it"},message.durationMs?.let {durationText(it,AppLanguage.code=="en")})
                    if(metadata.isNotEmpty()) Text(metadata.joinToString(" · "),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if (message.collapsible && message.role != "reasoning") {
                        Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!content?.command.isNullOrBlank() && content?.command != content?.text) CodeText(content!!.command)
                            content?.let { CodeText(it.text) }
                        }
                    }
                    else if (you || problem) SelectionContainer { Text(message.text, style = MaterialTheme.typography.bodyLarge) }
                    else content?.let { MarkdownMessage(it.text) }
                    MessageImages(content?:message,loadImage)
                    MessageFiles(content?:message,loadFile)
                }
            }
        }
    }
    }
}

@Composable fun ProcessGroupCard(message: Message, loadBody: suspend (Message)->Message, loadImage: suspend (Message,MessageImage)->ByteArray, loadFile: suspend (Message,MessageFile)->ByteArray) {
    var expanded by rememberSaveable(message.id) { mutableStateOf(false) }
    val last=message.items.lastOrNull()
    Surface(shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surface,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().semantics {stateDescription=tr(if(expanded) "已展开" else "已折叠")}
                .clickable(role=Role.Button) {expanded=!expanded}.heightIn(min=48.dp).padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Icon(painterResource(R.drawable.ic_chevron_right),null,Modifier.size(18.dp).rotate(if(expanded) 90f else 0f))
                    Text(tr(if(message.status=="inProgress") "正在处理" else "执行过程"),style=MaterialTheme.typography.labelLarge)
                    Text("${message.items.size} ${tr("项")}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if(message.status=="failed") Text(tr("有操作失败"),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error)
                }
                Text(processCounts(message.items),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(last!=null) Text(last.command.ifBlank {last.preview.ifBlank {last.text}},maxLines=1,overflow=TextOverflow.Ellipsis,
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if(expanded) {
                HorizontalDivider()
                Column(Modifier.padding(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    message.items.forEach { item -> key(item.id) {
                        MessageCard(item,loadBody,loadImage,loadFile,initiallyExpanded=item.role=="reasoning")
                    } }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun ApprovalCard(request: JSONObject, enabled: Boolean, decide: (String) -> Unit) {
    val method = request.optString("method")
    val choices=approvalDecisions(request)
    val permissions=method=="item/permissions/requestApproval"
    var confirm by remember(request.toString()) { mutableStateOf<String?>(null) }
    confirm?.let { decision -> AlertDialog(onDismissRequest={confirm=null},title={Text(tr(if(decision=="acceptForSession") "本会话内始终批准" else if(permissions) "批准本轮权限" else "仅批准这一次"))},
        text={Column(Modifier.heightIn(max=300.dp).verticalScroll(rememberScrollState())) {
            Text(tr(if(decision=="acceptForSession") "由官方桌面按本会话的授权范围记住批准；不是永久授权，后续匹配操作可能不再逐次询问。" else if(permissions) "仅批准请求中列出的权限，限当前轮次，不会永久授权。" else "请先核对操作详情，再批准这一次请求。"))
            Text(request.optJSONObject("params")?.toString(2).orEmpty(),style=MaterialTheme.typography.bodySmall)
        }},confirmButton={TextButton(onClick={confirm=null;decide(decision)},enabled=enabled&&decision in choices){Text(tr("确认批准"))}},
        dismissButton={TextButton(onClick={confirm=null}){Text(tr("取消"))}}) }
    NoticeCard(tr("需要审批"), approvalSummary(request, tr("请在官方 Codex 桌面查看完整请求。"), tr("文件变更或工具请求，请展开详情并核对后再批准。")).lineSequence().take(2).joinToString("\n").take(240)) {
        Text(method, style = MaterialTheme.typography.labelSmall)
        if(permissions) Text(tr("仅批准请求中列出的权限，限当前轮次，不会永久授权。"),style=MaterialTheme.typography.bodySmall)
        if (choices.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if("accept" in choices) FilledTonalButton(onClick = { confirm="accept" }, enabled = enabled) { Text(tr(if(permissions) "批准本轮权限" else "仅批准这一次")) }
            if("acceptForSession" in choices) OutlinedButton(onClick = { confirm="acceptForSession" }, enabled = enabled) { Text(tr("本会话内始终批准")) }
            if("decline" in choices) OutlinedButton(onClick = { decide("decline") }, enabled = enabled) { Text(tr("拒绝")) }
            if("cancel" in choices) OutlinedButton(onClick = { decide("cancel") }, enabled = enabled) { Text(tr("取消请求")) }
        } else Text(tr("此请求请在官方 Codex 桌面处理。"))
        RawDetails(request.optJSONObject("params")?.toString(2).orEmpty())
    }
}
