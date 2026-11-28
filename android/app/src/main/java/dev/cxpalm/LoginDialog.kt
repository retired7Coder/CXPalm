package dev.cxpalm

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.Manifest
import android.content.pm.PackageManager
import com.journeyapps.barcodescanner.ScanContract
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable fun LoginDialog(client: BridgeClient, initialAddress: String, startWithScan: Boolean = false, dismiss: () -> Unit) {
    val state by client.state.collectAsState()
    val context=LocalContext.current
    LaunchedEffect(Unit){client.clearError()}
    var address by rememberSaveable { mutableStateOf(initialAddress) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var rememberLogin by remember { mutableStateOf(false) }
    var scanError by remember { mutableStateOf<String?>(null) }
    var scannedAddress by rememberSaveable { mutableStateOf<String?>(null) }
    var scanning by rememberSaveable { mutableStateOf(false) }
    var autoScanStarted by rememberSaveable { mutableStateOf(false) }
    val scanner=rememberLauncherForActivityResult(ScanContract()) { result ->
        scanning=false
        result.contents?.let { value ->
            runCatching {scannedComputerOrigin(value)}
                .onSuccess {scannedAddress=it;scanError=null}
                .onFailure {scanError="二维码不是有效的 CXPalm 电脑地址，请扫描电脑「连接与登录」中的二维码。"}
        }
    }
    fun openScanner() {
        scanning=true
        try {scanner.launch(computerScanOptions(tr("扫描电脑 CXPalm「连接与登录」中的二维码")))}
        catch(_:Exception) {scanning=false;scanError="相机暂不可用，可以手动输入电脑地址。"}
    }
    val cameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if(granted)openScanner()
        else {scanning=false;scanError="未获得相机权限，可以手动输入地址，或在系统设置中允许相机。"}
    }
    fun scan() {
        scanError=null
        if(!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            scanError="这台设备没有可用相机，请手动输入电脑地址。";return
        }
        if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)openScanner()
        else {scanning=true;cameraPermission.launch(Manifest.permission.CAMERA)}
    }
    LaunchedEffect(Unit) {if(startWithScan&&!autoScanStarted){autoScanStarted=true;scan()}}
    scannedAddress?.let { target ->
        AlertDialog(onDismissRequest={scannedAddress=null},title={Text(tr("确认电脑地址"))},
            text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Text(target,style=MaterialTheme.typography.bodyLarge)
                Text(tr("请确认与电脑显示的地址一致。确认后只填写地址，再输入这台电脑的账号和密码。"),style=MaterialTheme.typography.bodySmall)
            }},confirmButton={TextButton(onClick={address=target;username="";password="";rememberLogin=false;scannedAddress=null}) {Text(tr("使用此地址"))}},
            dismissButton={TextButton(onClick={scannedAddress=null}) {Text(tr("取消"))}})
    }
    val valid=runCatching {loginOrigin(address)}.isSuccess && username.isNotBlank() && password.isNotEmpty()
    if(scannedAddress==null) AlertDialog(onDismissRequest={if(!client.loginBusy&&!scanning){password="";dismiss()}},title={Text(tr("添加电脑 / 账号登录"))},text={
        Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            state.error?.let {Text(tr(it),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            scanError?.let {Text(tr(it),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)}
            Text(tr("先在电脑 CXPalm 的「设置 → 登录账号」创建账号密码。"),style=MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick={scan()},enabled=!client.loginBusy&&!scanning,modifier=Modifier.fillMaxWidth()) {Text(tr("扫码获取电脑地址"))}
            OutlinedTextField(address,{address=it},label={Text(tr("电脑 HTTPS 地址"))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Uri),modifier=Modifier.fillMaxWidth(),enabled=!client.loginBusy)
            OutlinedTextField(username,{username=it},label={Text(tr("账号"))},singleLine=true,modifier=Modifier.fillMaxWidth(),enabled=!client.loginBusy)
            OutlinedTextField(password,{password=it},label={Text(tr("密码"))},singleLine=true,visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),modifier=Modifier.fillMaxWidth(),enabled=!client.loginBusy)
            Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {Checkbox(rememberLogin,{rememberLogin=it},enabled=!client.loginBusy);Text(tr("记住登录 · 30 天内无需重新登录"),style=MaterialTheme.typography.bodyMedium)}
            Text(tr("只保存加密的登录凭据，不保存明文密码。不勾选时仅在本次 App 运行期间保留登录。"),style=MaterialTheme.typography.bodySmall)
        }
    },confirmButton={TextButton(onClick={client.clearError();client.login("",address,username,password,rememberLogin){password="";dismiss()};password=""},enabled=valid&&!client.loginBusy&&!scanning&&scannedAddress==null){Text(if(client.loginBusy) tr("正在登录…") else tr("登录"))}},dismissButton={TextButton(onClick={password="";dismiss()},enabled=!client.loginBusy&&!scanning){Text(tr("取消"))}})
}
