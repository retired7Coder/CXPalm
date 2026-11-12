package dev.cxpalm

import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

const val UPDATE_ORIGIN = "https://github.com/702165405/CXPalm"
const val UPDATE_RELEASES = "$UPDATE_ORIGIN/releases/download"
const val UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/retired7Coder/CXPalm/main/updates/download.json"
const val MAX_MANIFEST_BYTES = 65536L
const val MAX_APK_BYTES = 128L * 1024 * 1024
const val UPDATE_INTERVAL_MS = 6L * 60 * 60 * 1000
const val UPDATE_CACHE_MS = 24L * 60 * 60 * 1000

data class UpdateManifest(val version: String, val versionCode: Int, val packageName: String,
    val apk: String, val size: Long, val sha256: String, val notes: String = "") {
    fun json(): String = JSONObject().put("version", version).put("versionCode", versionCode)
        .put("package", packageName).put("apk", apk).put("size", size).put("sha256", sha256)
        .put("notes", notes).toString()
}

fun updateApkUrl(value: String): String {
    val uri = URI(value)
    require(uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 &&
        uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
        uri.rawPath.matches(Regex("/(?:702165405|retired7Coder)/CXPalm/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+-build[0-9]+/CXPalm-[A-Za-z0-9._-]+\\.apk")) &&
        !value.contains("..") && !value.contains('%')) { "更新 APK 必须位于固定 GitHub 仓库的发布路径下" }
    return uri.toASCIIString()
}

internal fun updateRedirectUrl(from: String, location: String): String {
    val previous = URI(from)
    require(runCatching { updateApkUrl(from) }.isSuccess || updateCdn(previous)) { "更新跳转来源不受信任" }
    require(location.length <= 16384) { "更新跳转地址过长" }
    val next = previous.resolve(location)
    // The verified account rename preserves repository 1433754725 and the exact asset.
    val renamed=from.startsWith("https://github.com/702165405/CXPalm/")&&
        next.toASCIIString()==from.replace("https://github.com/702165405/CXPalm/","https://github.com/retired7Coder/CXPalm/")
    require(renamed||updateCdn(next)) { "更新跳转不属于此仓库的 GitHub 下载服务" }
    return next.toASCIIString()
}
private fun updateCdn(uri: URI): Boolean = uri.scheme == "https" && uri.port == -1 && uri.rawUserInfo == null && uri.rawFragment == null &&
    uri.host in listOf("release-assets.githubusercontent.com", "objects.githubusercontent.com") &&
    uri.rawPath?.matches(Regex("/github-production-release-asset(?:-2e65be)?/1433754725/[A-Za-z0-9-]+")) == true

fun parseUpdateManifest(text: String, installedPackage: String): UpdateManifest {
    require(text.toByteArray(Charsets.UTF_8).size <= MAX_MANIFEST_BYTES) { "更新清单过大" }
    val data = JSONObject(text)
    fun string(key: String): String {
        val value = data.get(key)
        require(value is String) { "更新清单的 $key 必须是字符串" }
        return value
    }
    fun integer(key: String): Long {
        val value = data.get(key)
        require(value is Int || value is Long) { "更新清单的 $key 必须是整数" }
        return (value as Number).toLong()
    }
    val version = string("version")
    val code = integer("versionCode")
    val size = integer("size")
    val pkg = string("package")
    val hash = string("sha256")
    val notes = if (data.has("notes")) string("notes") else ""
    require(version.matches(Regex("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})"))) { "版本名称无效" }
    require(code in 1..Int.MAX_VALUE.toLong()) { "版本号无效" }
    require(size in 1..MAX_APK_BYTES) { "更新 APK 大小超出安全限制" }
    require(pkg == installedPackage) { "更新不属于当前应用" }
    require(hash.matches(Regex("[0-9a-fA-F]{64}"))) { "更新校验值无效" }
    require(notes.length <= 4000) { "更新说明过长" }
    val apk = updateApkUrl(string("apk"))
    require(apk == "$UPDATE_RELEASES/v$version-build$code/CXPalm-$version-build$code-debug.apk") { "APK 路径与清单版本不一致" }
    return UpdateManifest(version, code.toInt(), pkg, apk, size, hash.lowercase(), notes)
}

fun shouldAutoCheck(now: Long, last: Long): Boolean = last == 0L || (now >= last && now - last >= UPDATE_INTERVAL_MS)
fun isNewerVersion(remote: Long, installed: Long): Boolean = remote > installed

data class ApkIdentity(val packageName: String, val version: String, val versionCode: Long, val certificates: Set<String>)

fun verifyApkIdentity(manifest: UpdateManifest, installed: ApkIdentity, archive: ApkIdentity) {
    require(manifest.packageName == installed.packageName && archive.packageName == installed.packageName) { "APK 包名不匹配" }
    require(isNewerVersion(archive.versionCode, installed.versionCode)) { "拒绝降级或重复安装" }
    require(archive.versionCode == manifest.versionCode.toLong() && archive.version == manifest.version) { "APK 版本与清单不一致" }
    require(installed.certificates.isNotEmpty() && archive.certificates == installed.certificates) { "APK 签名与已安装应用不匹配" }
}

fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

fun verifyUpdateFile(file: File, manifest: UpdateManifest, active: () -> Unit = {}) {
    require(file.isFile && file.length() == manifest.size) { "APK 实际大小与清单不一致" }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(32768)
        while (true) { active(); val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
    }
    require(digest.digest().joinToString("") { "%02x".format(it) } == manifest.sha256) { "APK SHA-256 校验失败" }
}

// Separate from BridgeClient: no account token, cookies or automatic redirects/retries.
fun updateHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(10, TimeUnit.MINUTES)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()

class UpdateTransport(private val client: OkHttpClient = updateHttpClient()) {
    private fun response(url: String, download: Boolean, onCall: (Call) -> Unit, active: () -> Unit = {}): okhttp3.Response {
        var current = url
        for (hop in 0..3) {
            active()
            val call = client.newCall(Request.Builder().url(current).header("Accept", if(download) "application/octet-stream" else "application/json")
                .header("Accept-Encoding", "identity").build())
            if (!download) call.timeout().timeout(30, TimeUnit.SECONDS)
            onCall(call)
            val result = call.execute()
            if (result.code !in listOf(301,302,303,307,308)) {
                if (result.header("Content-Encoding")?.let { it != "identity" } == true) { result.close(); throw IOException("更新响应压缩方式不受支持") }
                return result
            }
            result.use {
                if (!download || hop == 3) throw IOException("更新重定向次数或来源不受信任")
                current = try { updateRedirectUrl(current, it.header("Location") ?: throw IOException("更新跳转地址缺失")) }
                    catch (_: IllegalArgumentException) { throw IOException("更新跳转不受信任") }
            }
        }
        throw IOException("更新重定向次数过多")
    }
    fun manifest(packageName: String, onCall: (Call) -> Unit = {}): UpdateManifest {
        return response(UPDATE_MANIFEST_URL, false, onCall).use { response ->
            if (response.code != 200) throw IOException("检查更新失败（HTTP ${response.code}）")
            val body = response.body ?: throw IOException("更新清单为空")
            require(body.contentLength() <= MAX_MANIFEST_BYTES) { "更新清单过大" }
            val text = body.byteStream().use { readBounded(it, MAX_MANIFEST_BYTES).toString(Charsets.UTF_8) }
            parseUpdateManifest(text, packageName)
        }
    }

    fun download(manifest: UpdateManifest, partial: File, onCall: (Call) -> Unit = {},
        active: () -> Unit = {}, progress: (Long) -> Unit = {}) {
        try {
            response(updateApkUrl(manifest.apk), true, onCall, active).use { response ->
                if (response.code != 200) throw IOException("下载失败（HTTP ${response.code}）")
                val body = response.body ?: throw IOException("APK 响应为空")
                val length = body.contentLength()
                require(length == -1L || length == manifest.size) { "APK 响应大小不匹配" }
                body.byteStream().use { input -> partial.outputStream().use { output ->
                    val buffer = ByteArray(32768)
                    var count = 0L
                    while (true) {
                        active()
                        val n = input.read(buffer)
                        if (n < 0) break
                        count += n
                        require(count <= manifest.size && count <= MAX_APK_BYTES) { "APK 超出声明大小" }
                        output.write(buffer, 0, n); progress(count)
                    }
                } }
            }
            active(); verifyUpdateFile(partial, manifest, active)
        } catch (e: Exception) { partial.delete(); throw e }
    }
}

private fun readBounded(input: InputStream, limit: Long): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    var count = 0L
    while (true) { val n = input.read(buffer); if (n < 0) break; count += n; require(count <= limit) { "更新清单过大" }; output.write(buffer, 0, n) }
    return output.toByteArray()
}
