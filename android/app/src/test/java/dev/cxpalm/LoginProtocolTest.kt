package dev.cxpalm

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class LoginProtocolTest {
    @Test fun scannerKeepsAccountLoginAndCameraOptional() {
        val main=java.io.File("src/main")
        assertFalse(java.io.File(main,"java/dev/cxpalm/Pairing.kt").exists())
        val manifest=javax.xml.parsers.DocumentBuilderFactory.newInstance().apply {isNamespaceAware=true}
            .newDocumentBuilder().parse(java.io.File(main,"AndroidManifest.xml"))
        val android="http://schemas.android.com/apk/res/android"
        val features=manifest.getElementsByTagName("uses-feature")
        for(index in 0 until features.length) {
            val feature=features.item(index) as org.w3c.dom.Element
            if(feature.getAttributeNS(android,"name").startsWith("android.hardware.camera"))
                assertEquals("false",feature.getAttributeNS(android,"required"))
        }
        val scanner=java.io.File(main,"java/dev/cxpalm/ComputerScanner.kt").readText()
        assertTrue(scanner.contains(".setDesiredBarcodeFormats(ScanOptions.QR_CODE)"))
        assertTrue(scanner.contains(".setBarcodeImageEnabled(false)"))
        val bridge=java.io.File(main,"java/dev/cxpalm/BridgeClient.kt").readText()
        assertFalse(bridge.contains("/api/v1/pair"));assertFalse(bridge.contains("parsePairingLink"))
        assertFalse(java.io.File(main,"java/dev/cxpalm/PalmApp.kt").readText().contains("旧版配对"))
    }
    @Test fun desktopQRCodeDecodesToAddressWithoutCredentials() {
        // Android 编译桩不含桌面 ImageIO，测试在宿主 JVM 上读取服务端生成的原图。
        val image=Class.forName("javax.imageio.ImageIO").getMethod("read",java.io.File::class.java)
            .invoke(null,java.io.File("../../internal/control/testdata/computer-qr.png"))
        val width=image.javaClass.getMethod("getWidth").invoke(image) as Int
        val height=image.javaClass.getMethod("getHeight").invoke(image) as Int
        val pixels=image.javaClass.getMethod("getRGB",Int::class.javaPrimitiveType,Int::class.javaPrimitiveType,Int::class.javaPrimitiveType,Int::class.javaPrimitiveType,IntArray::class.java,Int::class.javaPrimitiveType,Int::class.javaPrimitiveType)
            .invoke(image,0,0,width,height,null,0,width) as IntArray
        val source=com.google.zxing.RGBLuminanceSource(width,height,pixels)
        val result=com.google.zxing.MultiFormatReader().decode(
            com.google.zxing.BinaryBitmap(com.google.zxing.common.HybridBinarizer(source)))
        assertEquals(com.google.zxing.BarcodeFormat.QR_CODE,result.barcodeFormat)
        assertEquals("https://cxpalm.example.test/cxpalm/",result.text)
        assertEquals("https://cxpalm.example.test",scannedComputerOrigin(result.text))
        for(value in listOf("https://host.test","https://host.test/","https://host.test:9443/cxpalm","https://[2001:db8::1]:9443/cxpalm/"))
            assertEquals(loginOrigin(value),scannedComputerOrigin(value))
        for(value in listOf("http://host.test","https://user:secret@host.test","https://host.test/?token=abc","https://host.test/?","https://host.test/#","https://host.test/#pair=abc","https://host.test/other","javascript:alert(1)","{\"token\":\"abc\"}","https://host.test:0","https://host.test:65536","https://host.test/\n","https://host.test/\u0000","x".repeat(2049)))
            assertTrue(value,runCatching {scannedComputerOrigin(value)}.isFailure)
    }
    @Test fun trustedAddressAndBoundedLifetime() {
        assertEquals("https://host.test",loginOrigin("https://host.test/cxpalm/"))
        for(value in listOf("http://host.test","https://user:secret@host.test","https://host.test/?password=secret","https://host.test/#pair=abc","https://host.test:0","https://host.test/other")) assertTrue(runCatching {loginOrigin(value)}.isFailure)
        val value=JSONObject().put("token","a".repeat(64)).put("device",JSONObject().put("id","b".repeat(32)).put("expires",1000+30*24*3600L))
        val remembered=loginComputer(value.toString(),"https://host.test","Host",true,1000)
        assertEquals(1000+30*24*3600L,remembered.expires)
        assertFalse(remembered.toString().contains(remembered.token))
        assertTrue(runCatching {loginComputer(value.toString(),"https://host.test","",false,1000)}.isFailure)
        value.getJSONObject("device").put("expires",1000+24*3600L)
        val temporary=loginComputer(value.toString(),"https://host.test","",false,1000)
        assertEquals("[]",savedComputers(listOf(temporary)))
        val saved=org.json.JSONArray(savedComputers(listOf(temporary,remembered)))
        assertEquals(1,saved.length());assertTrue(saved.getJSONObject(0).getBoolean("remember"))
        assertEquals(remembered.token,saved.getJSONObject(0).getString("token"))
        assertFalse(saved.getJSONObject(0).has("password"))
        value.getJSONObject("device").put("expires",999)
        assertTrue(runCatching {loginComputer(value.toString(),"https://host.test","",true,1000)}.isFailure)
    }
}
