package dev.cxpalm

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import io.github.u702165405.cxpalm.R
import io.github.u702165405.cxpalm.BuildConfig
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers

@OptIn(ExperimentalLayoutApi::class)
@Composable fun SettingsPage(state: ViewState, update: UpdateState, updates: UpdateManager,
    manageComputers: () -> Unit, notificationAllowed: Boolean, enableNotifications: () -> Unit, enableBackground: () -> Unit,
    stopBackground: () -> Unit, notificationSettings: () -> Unit, install: () -> Unit, clearMediaCache: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { SectionTitle(tr("设置"), tr("真实连接，清晰掌控")) }
        item { AppearanceSection() }
        item { LanguageSection() }
        item { MediaCacheSection(clearMediaCache) }
        item { UpdateSection(update, updates, install) }
        item {
            Surface(onClick = manageComputers, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(tr("连接与主机"), style = MaterialTheme.typography.titleSmall)
                        Text(state.current?.name ?: tr("尚未选择电脑"), style = MaterialTheme.typography.bodyMedium)
                        Text(tr("管理 {0} 台电脑 · 添加与切换", state.computers.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                }
            }
        }
        item { SettingsSection(tr("系统通知与后台连接")) {
            Text(if (Runtime.backgroundActive) tr("后台连接已开启") else tr("后台连接未开启"), style = MaterialTheme.typography.titleMedium)
            Text(if (notificationAllowed) tr("系统已允许通知") else tr("系统通知未授权或已关闭"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(tr("任意已连接电脑的任务完成或待审批都发送系统通知，前台也一样，不再显示 App 内通知条。点击系统通知可打开对应电脑和会话。离开 App 后需开启后台连接；系统回收或强制停止后无法保证送达。桌面端只转发，不接收通知。"), style = MaterialTheme.typography.bodyMedium)
            state.computers.forEach { computer ->
                val status = state.notificationStatus[computer.id]
                Text("${computer.name} · ${when { !state.notificationStatus.containsKey(computer.id) -> tr("监听未启动"); status == null -> tr("提醒已连接"); status == "revoked" -> tr("登录已失效，请重新登录"); status == "unsupported" -> tr("请更新此电脑的网关"); else -> tr("提醒连接中或暂不可用") }}", style = MaterialTheme.typography.bodySmall)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!notificationAllowed) FilledTonalButton(onClick = enableNotifications) { Text(tr("开启系统通知")) }
                if (Runtime.backgroundActive) OutlinedButton(onClick = stopBackground) { Text(tr("停止后台连接")) }
                else FilledTonalButton(onClick = enableBackground, enabled = state.current != null) { Text(tr("开启后台连接")) }
                TextButton(onClick = notificationSettings) { Text(tr("系统通知设置")) }
            }
        } }
        item { Text(tr("CXPalm 是独立开发的 Codex 配套工具，非 OpenAI 官方应用。开发签名 APK，请仅从固定发布站点安装。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable private fun MediaCacheSection(clear: ()->Unit) {
    val scope=rememberCoroutineScope()
    var busy by remember {mutableStateOf(false)}
    var status by remember {mutableStateOf("")}
    SettingsSection(tr("图片与文档缓存")) {
        Text(tr("重复查看时复用本地文件，只确认授权和文件版本；原文件变化后重新下载。最多保留 64 MiB、24 项，7 天后过期。"))
        OutlinedButton(enabled=!busy,onClick={
            busy=true
            scope.launch {
                try {withContext(Dispatchers.IO){clear()};status="缓存已清除，下次查看将重新下载。"}
                catch(_:Exception){status="缓存清理失败，请重试。"}
                finally{busy=false}
            }
        }) {Text(tr(if(busy)"正在清理…" else "清除图片和文档缓存"))}
        Text(tr(if(status.isEmpty())"清理不会删除聊天、草稿或已保存到下载目录的文件。" else status),style=MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun SettingsSection(title: String, initiallyExpanded: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    var expanded by rememberSaveable(title) { mutableStateOf(initiallyExpanded) }
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().clickable(role = androidx.compose.ui.semantics.Role.Button) { expanded = !expanded }
                .heightIn(min = 56.dp).padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 270f else 90f))
            }
            if (expanded) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun AppearanceSection() {
    val context = LocalContext.current
    var error by remember { mutableStateOf(false) }
    SettingsSection(tr("外观"), initiallyExpanded = true) {
        Text(tr("选择阅读配色，只改变本机界面，不影响电脑连接。"), style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("system" to tr("跟随系统"), "light" to tr("明亮工作台"), "dark" to tr("雾蓝夜间")).forEach { (mode, label) ->
                FilterChip(selected = AppAppearance.mode == mode, onClick = {
                    try { AppAppearance.select(context, mode); error = false } catch (_: Exception) { error = true }
                }, label = { Text(label) })
            }
        }
        Text(tr("外观已保存，下次打开仍然生效。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if(error) Text(tr("无法保存外观，请稍后重试"), color = MaterialTheme.colorScheme.error)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun UpdateSection(state: UpdateState, updates: UpdateManager, install: () -> Unit) {
    SettingsSection(tr("在线更新"), initiallyExpanded = true) {
        Text("${BuildConfig.VERSION_NAME} / build ${BuildConfig.VERSION_CODE}", style = MaterialTheme.typography.titleLarge)
        Text(tr("无需登录电脑也能更新。启动或返回前台时检查，自动检查至少间隔 6 小时；点击下载前不会获取 APK。"), style = MaterialTheme.typography.bodyMedium)
        Text(UPDATE_MANIFEST_URL, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.lastChecked > 0) Text(tr("上次检查：{0}" , DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, AppLanguage.locale).format(Date(state.lastChecked))), style = MaterialTheme.typography.bodySmall)
        when (state.phase) {
            UpdatePhase.CHECKING -> { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(tr("正在检查更新…")) }
            UpdatePhase.CURRENT -> Text(tr("当前已是最新版本"), color = MaterialTheme.colorScheme.primary)
            UpdatePhase.IDLE -> Text(tr("等待检查"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Unit
        }
        val manifest = state.manifest
        if (manifest != null && state.phase != UpdatePhase.CHECKING) {
            HorizontalDivider()
            Text("${manifest.version} · build ${manifest.versionCode}", style = MaterialTheme.typography.titleMedium)
            Text("${fileSize(manifest.size)} · ${if (state.phase == UpdatePhase.READY) tr("下载已校验，等待系统安装") else tr("可用更新")}")
            if (manifest.notes.isNotBlank()) Text(manifest.notes)
            else Text(tr("发布者未提供更新说明。"), style = MaterialTheme.typography.bodySmall)
            if (state.phase == UpdatePhase.DOWNLOADING) {
                LinearProgressIndicator(progress = { (state.downloaded.toFloat() / manifest.size).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                Text(if (state.downloaded >= manifest.size) tr("下载完成，正在校验应用身份…") else "${fileSize(state.downloaded)} / ${fileSize(manifest.size)}")
                OutlinedButton(onClick = updates::cancel) { Text(tr("取消下载")) }
            } else if (state.phase == UpdatePhase.READY) {
                Button(onClick = install, modifier = Modifier.fillMaxWidth()) { Text(tr("打开系统安装确认")) }
                Text(tr("如未授权，系统将先询问是否允许安装。你可随时取消；不会静默安装或影响现有聊天。"), style = MaterialTheme.typography.bodySmall)
            } else Button(onClick = updates::download, modifier = Modifier.fillMaxWidth()) { Text(if (state.phase == UpdatePhase.ERROR) tr("重新下载（使用网络流量）") else tr("下载更新（使用网络流量）")) }
        }
        if (state.message != null && state.phase != UpdatePhase.CURRENT) Text(tr(state.message), color = if (state.phase == UpdatePhase.ERROR) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.phase != UpdatePhase.DOWNLOADING) OutlinedButton(onClick = { updates.check() }, enabled = state.phase != UpdatePhase.CHECKING, modifier = Modifier.fillMaxWidth()) { Text(tr("立即检查更新")) }
        Text(tr("仅接受固定 HTTPS 站点的 APK，核验大小、SHA-256、包名、版本及当前安装证书。缓存 24 小时后过期；取消或失败会清理下载。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun LanguageSection() {
    val context = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }
    SettingsSection(tr("应用语言")) {
        Text(tr("切换后立即生效，只改变界面语言，不翻译会话内容。"), style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("zh-CN" to "中文", "en" to "English").forEach { (code, label) ->
                FilterChip(selected = AppLanguage.code == code, onClick = {
                    try { AppLanguage.select(context, code); error = null }
                    catch (failure: Exception) { error = failure.message }
                }, label = { Text(label) })
            }
        }
        Text(tr("语言已保存，下次打开仍使用此语言。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        error?.let { Text(tr(it), color = MaterialTheme.colorScheme.error) }
    }
}


@Composable fun ComputersPage(state: ViewState, client: BridgeClient, login: () -> Unit, select: (Computer) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text(tr("选择本次对话使用的电脑。其他已登录电脑的提醒监听不受切换影响。"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        state.computers.forEach { computer -> item(key = computer.id) {
            val current = state.current?.id == computer.id
            Surface(shape = MaterialTheme.shapes.large, color = if (current) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (current) MaterialTheme.colorScheme.primary.copy(alpha = .35f) else MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(computer.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        if (current) Text(tr("当前电脑"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Text(computer.origin, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (current) Text(when { state.desktopConnected -> tr("官方桌面已连接"); state.connected -> tr("Agent 已连接"); else -> tr("已断开") }, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { select(computer) }, enabled = true) {
                            Text(if (!current) tr("使用这台电脑") else if (state.connected) tr("返回会话") else tr("重新连接"))
                        }
                        TextButton(onClick = {client.logout(computer)},enabled=!client.hasPending(computer)&&!client.loginBusy) {Text(tr("退出登录"))}
                        if (current && state.connected) TextButton(onClick = client::disconnect, enabled = true) { Text(tr("断开连接")) }
                    }
                }
            }
        } }
        item {
            OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(tr("添加电脑"), style = MaterialTheme.typography.titleSmall)
                    Text(tr("在电脑设置登录账号，再输入 HTTPS 地址、账号和密码。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = login, enabled = !client.loginBusy) { Text(tr("账号登录")) }
                    }
                }
            }
        }
        item { Text(tr("主会话归属官方桌面。记住登录的凭据和草稿加密保存在本机；登录授权可在电脑撤销。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
