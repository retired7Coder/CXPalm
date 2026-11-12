package dev.cxpalm

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.u702165405.cxpalm.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PalmApp(state: ViewState, client: BridgeClient, update: UpdateState, updates: UpdateManager,
    notificationAllowed: Boolean, enableNotifications: () -> Unit, enableBackground: () -> Unit, stopBackground: () -> Unit,
    notificationSettings: () -> Unit, install: () -> Unit, showUpdates: Boolean, consumeUpdates: () -> Unit) {
    var quickComputers by remember { mutableStateOf(false) }
    var page by rememberSaveable { mutableStateOf("sessions") }
    val savedScreens = rememberSaveableStateHolder()
    var loginOpen by remember { mutableStateOf(false) }
    var notices by remember { mutableStateOf(false) }
    var updatePrompt by remember { mutableStateOf(false) }
    var promptedVersion by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(update.phase, update.manifest?.versionCode) {
        val code = update.manifest?.versionCode ?: 0
        if (update.phase == UpdatePhase.AVAILABLE && code > promptedVersion) { promptedVersion = code; updatePrompt = true }
    }
    LaunchedEffect(state.notificationNavigation) {
        if (state.notificationNavigation > 0) { page = "sessions"; notices = false }
    }
    LaunchedEffect(showUpdates) { if (showUpdates) { page = "settings"; consumeUpdates() } }
    BackHandler(page != "sessions" || state.thread != null) {
        if (page != "sessions") page = appBackDestination(page) else client.leaveChat()
    }
    Scaffold(Modifier.imePadding(), containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.statusBarsPadding().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal)).padding(horizontal = 16.dp)) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (page == "sessions" && state.thread != null) IconButton(onClick = client::leaveChat) { Icon(painterResource(R.drawable.ic_arrow_back), tr("返回会话")) }
                        else if (page == "sessions") Image(painterResource(R.drawable.app_icon), "CXPalm", Modifier.size(34.dp))
                        else IconButton(onClick = { page = appBackDestination(page) }) { Icon(painterResource(R.drawable.ic_arrow_back), tr("返回")) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(when (page) { "settings" -> tr("设置"); "computers" -> tr("连接与主机"); else -> (state.current?.name ?: "CXPalm") }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (page == "sessions") Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(Modifier.size(7.dp).background(if (state.connected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, CircleShape))
                                Text(currentConnectionLabel(state), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (page == "sessions" && state.thread == null) TextButton(onClick = { quickComputers = true }, contentPadding = PaddingValues(horizontal = 8.dp)) {
                            Icon(painterResource(R.drawable.ic_monitor), null, Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp));Text(tr("切换电脑"), maxLines = 1)
                        }
                        if (page == "sessions" && state.thread != null) IconButton(onClick = { quickComputers = true }) { Icon(painterResource(R.drawable.ic_monitor), tr("切换电脑")) }
                        if (page == "sessions" && state.thread != null) IconButton(onClick = { page = "settings" }) {
                            Icon(painterResource(R.drawable.ic_settings), tr("设置"))
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }, bottomBar = {
            // Keep the conversation viewport and composer compact while reading.
            if (page != "sessions" || state.thread == null) NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                listOf(Triple("sessions", tr("会话"), R.drawable.ic_chat_mode), Triple("computers", tr("电脑"), R.drawable.ic_monitor), Triple("settings", tr("设置"), R.drawable.ic_settings)).forEach { (destination, label, icon) ->
                    NavigationBarItem(selected = page == destination, onClick = { page = destination }, icon = {
                        BadgedBox(badge = { if(destination == "settings" && update.phase in listOf(UpdatePhase.AVAILABLE, UpdatePhase.READY)) Badge() }) { Icon(painterResource(icon), null) }
                    }, label = { Text(label) })
                }
            }
        }) { inner ->
        Column(Modifier.fillMaxSize().padding(inner).consumeWindowInsets(inner).padding(horizontal = 16.dp).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AnimatedVisibility(state.error != null || (state.current != null && !state.connected), enter = fadeIn(), exit = fadeOut()) {
                Surface(onClick = { notices = true }, color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(state.error?.let {conciseNotice(tr(it))} ?: currentConnectionLabel(state), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
                        Text(tr("查看"), Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            Box(Modifier.weight(1f)) {
                when (page) {
                    "sessions" -> if (state.current == null) WelcomePage({ loginOpen = true }, client.loginBusy)
                        else if (state.thread == null) savedScreens.SaveableStateProvider("sessions:${state.current.id}") { SessionsPage(state, client) }
                        else savedScreens.SaveableStateProvider("chat:${state.current.id}:${state.thread}") { ChatPage(state, client) }
                    "computers" -> ComputersPage(state, client, { loginOpen = true }) { computer ->
                        if (state.current?.id != computer.id || !state.connected) client.connect(computer)
                        page = "sessions"
                    }
                    else -> savedScreens.SaveableStateProvider("settings") {
                        SettingsPage(state, update, updates, { page = "computers" },
                            notificationAllowed, enableNotifications, enableBackground, stopBackground, notificationSettings, install, client::clearMediaCache)
                    }
                }
            }
        }
    }
    if (quickComputers) ComputerSwitchSheet(state, { quickComputers = false }, { computer ->
        quickComputers = false
        if (computer.id != state.current?.id || !state.connected) client.connect(computer)
    }, { quickComputers = false; page = "computers" })
    if (notices) AlertDialog(onDismissRequest = { notices = false }, title = { Text(tr("连接与操作状态")) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.error != null) NoticeCard(tr("连接或操作提示"), tr(state.error), error = true) { TextButton(onClick = client::clearError) { Text(tr("关闭提示")) } }
            if (state.current != null && !state.connected) NoticeCard(tr("连接已断开"), tr("连接恢复前不能发送；结果未知的操作不会自动重放。")) {
                IconButton(onClick = { client.connect(state.current); notices = false }) { Icon(painterResource(R.drawable.ic_refresh), tr("重新连接")) }
            }
        }
    }, confirmButton = { TextButton(onClick = { notices = false }) { Text(tr("完成")) } })
    if (updatePrompt && update.manifest != null) AlertDialog(onDismissRequest = { updatePrompt = false }, title = { Text(tr("发现 CXPalm 新版本")) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${update.manifest.version} · build ${update.manifest.versionCode} · ${fileSize(update.manifest.size)}")
            Text(update.manifest.notes.ifBlank { tr("发布者未提供更新说明。") })
            Text(tr("来自 {0}。点击后使用网络流量下载，校验后仍需系统安装确认。" , UPDATE_ORIGIN), style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = { updatePrompt = false; page = "settings"; updates.download() }) { Text(tr("下载更新")) } },
        dismissButton = { TextButton(onClick = { updatePrompt = false }) { Text(tr("稍后")) } })
    if(loginOpen) LoginDialog(client,state.current?.origin.orEmpty()) { loginOpen=false }
}

@Composable private fun WelcomePage(login: () -> Unit, busy: Boolean) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(180.dp).background(Brush.linearGradient(listOf(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.surface)), MaterialTheme.shapes.extraLarge), contentAlignment = Alignment.Center) {
            Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface, shadowElevation = 6.dp) {
                Image(painterResource(R.drawable.app_icon), null, Modifier.padding(14.dp).size(80.dp))
            }
        }
        Text(tr("桌面还在。\n灵感随行。"), style = MaterialTheme.typography.headlineLarge)
        Text(tr("连接电脑上的官方 Codex，继续同一个会话。你的主会话始终由原桌面执行。"), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = login, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(if (busy) tr("正在登录…") else tr("账号登录")) }
        Text(tr("电脑需保持 Codex 与 CXPalm 网关开启。在电脑设置登录账号，网页与 App 可记住登录 30 天。"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
