package dev.cxpalm

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.nio.file.Files
import java.util.concurrent.CancellationException

class UpdateTest {
    private val pkg = "io.github.u702165405.cxpalm.debug"
    private val bytes = "apk fixture, not an installable APK".toByteArray()
    private fun manifest(code: Int = 3) = UpdateManifest("0.0.2", code, pkg, "$UPDATE_RELEASES/v0.0.2-build3/CXPalm-0.0.2-build3-debug.apk", bytes.size.toLong(), sha256(bytes), "中文说明")
    private fun rejected(block: () -> Unit) { try { block(); fail("Unsafe update accepted") } catch (_: IllegalArgumentException) { } }
    private fun transport(status: Int = 200, body: ByteArray = bytes, inspect: (Request) -> Unit = {}): UpdateTransport =
        UpdateTransport(updateHttpClient().newBuilder().addInterceptor { chain ->
            inspect(chain.request())
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("test")
                .header("Location", "https://outside.invalid/evil.apk").body(body.toResponseBody("application/octet-stream".toMediaType())).build()
        }.build())
    private fun temp(block: (File) -> Unit) {
        val directory = Files.createTempDirectory("cxpalm-update-test").toFile()
        try { block(File(directory, "partial.apk")) } finally { directory.listFiles()?.forEach { it.delete() }; directory.delete() }
    }

    @Test fun automaticChecksHaveSixHourMinimumAndManualPolicyIsSeparate() {
        val now = 1_000_000_000L
        assertTrue(shouldAutoCheck(now, 0))
        assertFalse(shouldAutoCheck(now, now))
        assertFalse(shouldAutoCheck(now + UPDATE_INTERVAL_MS - 1, now))
        assertTrue(shouldAutoCheck(now + UPDATE_INTERVAL_MS, now))
        assertFalse(shouldAutoCheck(now - 1, now))
    }
    @Test fun manifestRoundTripRetainsIdentityAndOptionalNotes() {
        assertEquals(manifest(), parseUpdateManifest(manifest().json(), pkg))
        val old = JSONObject(manifest().json()).remove("notes")
        assertNotNull(old)
        val raw = JSONObject(manifest().json()).apply { remove("notes") }
        assertEquals(manifest().copy(notes = ""), parseUpdateManifest(raw.toString(), pkg))
    }
    @Test fun noUpdateAndOlderManifestsDoNotOfferDownloads() {
        assertFalse(isNewerVersion(2, 2))
        assertFalse(isNewerVersion(1, 2))
        assertTrue(isNewerVersion(3, 2))
    }
    @Test fun manifestRejectsMalformedAndUnboundedFields() {
        for ((key, value) in listOf("size" to 0, "size" to MAX_APK_BYTES + 1, "size" to "12", "size" to 1.5,
            "versionCode" to 0, "versionCode" to Int.MAX_VALUE.toLong() + 1, "versionCode" to "3", "version" to 2,
            "package" to "another.app", "sha256" to "bad", "notes" to "x".repeat(4001))) {
            rejected { parseUpdateManifest(JSONObject(manifest().json()).put(key, value).toString(), pkg) }
        }
        rejected { parseUpdateManifest(" ".repeat(MAX_MANIFEST_BYTES.toInt() + 1), pkg) }
    }
    @Test fun onlyFixedRepositoryReleaseApkPathsAreAccepted() {
        assertEquals("https://raw.githubusercontent.com/retired7Coder/CXPalm/main/updates/download.json", UPDATE_MANIFEST_URL)
        assertEquals(manifest().apk, updateApkUrl(manifest().apk))
        for (input in listOf("https://old-updates.example.test/cxpalm/a.apk", "http://github.com/702165405/CXPalm/releases/download/v0.0.2-build3/a.apk",
            manifest().apk.replace("702165405", "another-owner"), manifest().apk.replace("CXPalm/releases", "Other/releases"),
            manifest().apk.replace("github.com/", "user@github.com/"), manifest().apk.replace("github.com/", "github.com:443/"),
            "//github.com/702165405/CXPalm/a.apk", "CXPalm-0.0.2-build3-debug.apk", "../a.apk", "/android/a.apk",
            manifest().apk+"?token=x", manifest().apk+"#x", manifest().apk.replace(".apk", "%2eapk"), manifest().apk.replace(".apk", ".zip"))) {
            rejected { updateApkUrl(input) }
        }
        rejected { parseUpdateManifest(JSONObject(manifest().json()).put("apk", manifest().apk.replace("v0.0.2-build3", "v0.0.1-build3")).toString(), pkg) }
    }
    @Test fun packageVersionAndExactInstalledSignerAreRequired() {
        val installed = ApkIdentity(pkg, "0.0.1", 2, setOf("installed-certificate"))
        val correct = ApkIdentity(pkg, "0.0.2", 3, installed.certificates)
        verifyApkIdentity(manifest(), installed, correct)
        for (archive in listOf(correct.copy(packageName = "other"), correct.copy(version = "wrong"), correct.copy(versionCode = 2),
            correct.copy(versionCode = 1), correct.copy(versionCode = 4), correct.copy(certificates = emptySet()),
            correct.copy(certificates = setOf("other")), correct.copy(certificates = installed.certificates + "other"))) {
            rejected { verifyApkIdentity(manifest(), installed, archive) }
        }
        rejected { verifyApkIdentity(manifest(), installed.copy(certificates = emptySet()), correct) }
    }
    @Test fun successfulDownloadIsBoundedHashedAndUnauthenticated() = temp { file ->
        var progress = 0L
        transport(inspect = { request ->
            assertEquals(manifest().apk, request.url.toString())
            assertNull(request.header("Authorization")); assertNull(request.header("Origin")); assertNull(request.header("Cookie"))
            assertEquals("identity", request.header("Accept-Encoding"))
        }).download(manifest(), file, progress = { progress = it })
        assertArrayEquals(bytes, file.readBytes()); assertEquals(bytes.size.toLong(), progress)
    }
    @Test fun manifestUsesOnlyFixedPublicEndpointWithoutBearer() {
        val result = transport(body = manifest().json().toByteArray(), inspect = { request ->
            assertEquals(UPDATE_MANIFEST_URL, request.url.toString()); assertNull(request.header("Authorization")); assertNull(request.header("Origin"))
        }).manifest(pkg)
        assertEquals(manifest(), result)
    }
    @Test fun redirectAndErrorResponsesNeverBecomeDownloads() = temp { file ->
        for (code in listOf(301, 302, 307, 401, 404, 500)) {
            try { transport(status = code).download(manifest(), file); fail("Accepted HTTP $code") } catch (_: IOException) { }
            assertFalse(file.exists())
        }
        val client = updateHttpClient()
        assertFalse(client.followRedirects); assertFalse(client.followSslRedirects); assertFalse(client.retryOnConnectionFailure)
    }
    @Test fun sizeAndHashFailuresRemovePartialFiles() = temp { file ->
        for (meta in listOf(manifest().copy(size = bytes.size - 1L), manifest().copy(size = bytes.size + 1L), manifest().copy(sha256 = "0".repeat(64)))) {
            rejected { transport().download(meta, file) }; assertFalse(file.exists())
        }
    }
    @Test fun cancellationCleansUpAndRetryStartsFromZero() = temp { file ->
        file.writeText("stale partial must not be resumed")
        var n = 0
        try { transport().download(manifest(), file, active = { if (++n > 1) throw CancellationException() }); fail("Not cancelled") }
        catch (_: CancellationException) { }
        assertFalse(file.exists())
        transport().download(manifest(), file)
        assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun cancelCallAndNetworkFailuresRemainRetryable() = temp { file ->
        try { transport().download(manifest(), file, onCall = { it.cancel() }); fail("Not cancelled") } catch (_: IOException) { }
        assertFalse(file.exists())
        for (failure in listOf(IOException("offline"), SocketTimeoutException("timeout"))) {
            val client = updateHttpClient().newBuilder().addInterceptor { throw failure }.build()
            try { UpdateTransport(client).download(manifest(), file); fail("Network error swallowed") } catch (_: IOException) { }
            assertFalse(file.exists())
        }
        transport().download(manifest(), file); assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun unknownLengthResponsesStillEnforceActualByteLimit() = temp { file ->
        val client = updateHttpClient().newBuilder().addInterceptor { chain ->
            val source = okio.Buffer().write(bytes + bytes)
            val body = object : ResponseBody() {
                override fun contentType() = "application/octet-stream".toMediaType()
                override fun contentLength() = -1L
                override fun source() = source
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("test").body(body).build()
        }.build()
        rejected { UpdateTransport(client).download(manifest(), file) }; assertFalse(file.exists())
        rejected { transport(body = ByteArray(MAX_MANIFEST_BYTES.toInt() + 1)).manifest(pkg) }
    }

    @Test fun githubRedirectsAreRepositoryBoundedAndNeverCarryLoginHeaders() = temp { file ->
        val cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/1433754725/fixture-asset?sig=fixture"
        assertEquals(cdn, updateRedirectUrl(manifest().apk, cdn))
        val renamed=manifest().apk.replace("/702165405/","/retired7Coder/")
        assertEquals(renamed,updateRedirectUrl(manifest().apk,renamed))
        assertEquals(cdn,updateRedirectUrl(renamed,cdn))
        for(target in listOf(renamed+"?x=1",renamed+"#x",renamed.replace("CXPalm/releases","Other/releases"),renamed.replace("-debug.apk","-other.apk"))) {
            rejected {updateRedirectUrl(manifest().apk,target)}
        }
        for (target in listOf(cdn.replace("1433754725", "99"), cdn.replace("release-assets.githubusercontent.com", "evil.invalid"),
            cdn.replace("https://", "http://"), cdn+"#fragment", cdn.replace("https://", "https://user@"), manifest().apk)) {
            rejected { updateRedirectUrl(manifest().apk, target) }
        }
        val urls = mutableListOf<String>()
        val client = updateHttpClient().newBuilder().addInterceptor { chain ->
            val request = chain.request(); urls.add(request.url.toString())
            assertNull(request.header("Authorization")); assertNull(request.header("Cookie")); assertNull(request.header("Origin"))
            val redirect = request.url.host == "github.com"
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(redirect) 302 else 200).message("fixture")
                .header("Location", if(request.url.toString()==manifest().apk)renamed else cdn).body((if(redirect) byteArrayOf() else bytes).toResponseBody()).build()
        }.build()
        UpdateTransport(client).download(manifest(), file)
        assertEquals(listOf(manifest().apk, renamed, cdn), urls)
        assertArrayEquals(bytes, file.readBytes())
        val loop = updateHttpClient().newBuilder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(302).message("fixture")
                .header("Location", cdn).body(byteArrayOf().toResponseBody()).build()
        }.build()
        try { UpdateTransport(loop).download(manifest(),file); fail("redirect loop accepted") } catch (_: IOException) { }
        assertFalse(file.exists())
        try { UpdateTransport(loop).manifest(pkg); fail("manifest redirect accepted") } catch (_: IOException) { }
    }
}
