package dev.cxpalm

import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.ScanOptions

class ComputerScannerActivity : CaptureActivity()

// 扫描结果只用来填写地址，不接受账号、令牌、配对片段或任意跳转链接。
internal fun scannedComputerOrigin(value: String): String {
    require(value.length in 1..2048 && value.none { it.isISOControl() }) {
        "二维码不是有效的 CXPalm 电脑地址，请扫描电脑「连接与登录」中的二维码。"
    }
    return loginOrigin(value)
}

internal fun computerScanOptions(prompt: String): ScanOptions = ScanOptions()
    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
    .setCaptureActivity(ComputerScannerActivity::class.java)
    .setOrientationLocked(false)
    .setBeepEnabled(false)
    .setBarcodeImageEnabled(false)
    .setPrompt(prompt)
