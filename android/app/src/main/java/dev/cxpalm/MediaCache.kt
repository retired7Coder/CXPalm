package dev.cxpalm

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray

internal data class MediaResponse(val status: Int, val bytes: ByteArray = byteArrayOf(), val mime: String = "", val revision: String = "")
internal fun mediaRevision(bytes: ByteArray): String = "\"sha256-${MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }}\""

internal class MediaCache(private val folder: File,
    private val seal: (String,ByteArray)->ByteArray,
    private val unseal: (String,ByteArray)->ByteArray,
    private val now: ()->Long = System::currentTimeMillis) {
    private val names=Regex("[a-f0-9]{64}-[a-f0-9]{64}\\.bin")
    private val generations=AtomicInteger()
    private val pending=ConcurrentHashMap<String,FutureTask<ByteArray>>()
    // Bound encrypted buffers when several large images enter the viewport together.
    private val transfers=Semaphore(2)
    private val maximum=20*1024*1024
    private val lifetime=7L*86400000
    init {
        folder.listFiles()?.filter {it.name.startsWith("media-")&&it.name.endsWith(".part")&&it.canonicalFile.parentFile==folder.canonicalFile}?.forEach {it.delete()}
    }
    private fun digest(value: String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {"%02x".format(it)}
    private fun files()=folder.listFiles()?.filter {names.matches(it.name)&&it.isFile&&it.canonicalFile.parentFile==folder.canonicalFile}.orEmpty()
    @Synchronized fun clear(scope: String? = null) {
        generations.incrementAndGet();pending.clear()
        files().filter {scope==null||it.name.startsWith("$scope-")}.forEach {check(it.delete()||!it.exists()) {"Cache removal failed"}}
    }
    @Synchronized private fun saved(key: String): MediaResponse? {
        val file=File(folder,"$key.bin")
        return try {
            if(!file.isFile)return null
            require(file.canonicalFile.parentFile==folder.canonicalFile&&file.length() in 1..(maximum+1024).toLong()&&now()-file.lastModified() in 0..lifetime)
            val raw=unseal(key,file.readBytes())
            val first=raw.indexOf(10.toByte());require(first in 1..100)
            val second=(first+1 until minOf(raw.size,200)).firstOrNull {raw[it]==10.toByte()}?:error("Invalid media cache")
            val revision=String(raw,0,first,Charsets.US_ASCII)
            val mime=String(raw,first+1,second-first-1,Charsets.US_ASCII)
            val bytes=raw.copyOfRange(second+1,raw.size)
            require(bytes.size<=maximum&&revision==mediaRevision(bytes))
            MediaResponse(200,bytes,mime,revision)
        }catch(_:Exception){file.delete();null}
    }
    @Synchronized private fun save(key: String,response: MediaResponse,generation: Int) {
        if(generations.get()!=generation)return
        var part: File?=null
        try {
            folder.mkdirs()
            val target=File(folder,"$key.bin")
            require(target.canonicalFile.parentFile==folder.canonicalFile)
            part=File.createTempFile("media-",".part",folder)
            part.writeBytes(seal(key,(response.revision+"\n"+response.mime+"\n").toByteArray(Charsets.US_ASCII)+response.bytes))
            Files.move(part.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
            target.setLastModified(now())
            var bytes=0L
            files().sortedByDescending {it.lastModified()}.forEachIndexed {index,file->
                bytes+=file.length()
                if(index>=24||bytes>64L*1024*1024||now()-file.lastModified() !in 0..lifetime)file.delete()
            }
        }catch(_:Exception) {
            // Cache storage is optional; a successfully verified download remains usable.
        }finally{part?.delete()}
    }
    fun read(scope: String,kind: String,thread: String,turn: String,item: String,id: String,
        valid: ()->Boolean,fetch: (String?)->MediaResponse): ByteArray {
        require(scope.matches(Regex("[a-f0-9]{64}"))&&kind in listOf("image","file"))
        val generation=generations.get()
        val key="$scope-${digest(JSONArray(listOf(kind,thread,turn,item,id)).toString())}"
        val activeKey="$generation:$key"
        val current={generations.get()==generation&&valid()}
        require(current()) {"Reading target changed"}
        val task=FutureTask {
            transfers.acquire()
            try {
            val cached=saved(key)
            require(current()) {"Reading target changed"}
            val response=fetch(cached?.revision)
            require(current()) {"Reading target changed"}
            if(response.status in listOf(401,403)){clear(scope);error("Authorization expired")}
            if(response.status==204) {
                require(cached!=null&&response.revision==cached.revision) {"Cache version rejected"}
                require(cached.mime in if(kind=="image") listOf("image/png","image/jpeg","image/gif","image/webp") else listOf("application/octet-stream"))
                cached.bytes
            } else {
                if(response.status==404)synchronized(this){File(folder,"$key.bin").delete()}
                require(response.status==200) {"File unavailable"}
                require(response.mime in if(kind=="image") listOf("image/png","image/jpeg","image/gif","image/webp") else listOf("application/octet-stream"))
                require(response.bytes.size<=maximum&&(kind!="image"||response.bytes.isNotEmpty())) {"File exceeds download limit"}
                if(response.revision.isNotEmpty()) {
                    require(response.revision==mediaRevision(response.bytes)) {"Media integrity check failed"}
                    save(key,response,generation)
                }
                response.bytes
            }
            }finally{transfers.release()}
        }
        val operation=pending.putIfAbsent(activeKey,task)?:task.also {it.run()}
        try {
            return operation.get().also {require(current()) {"Reading target changed"}}
        }catch(error:ExecutionException){throw error.cause?:error}
        finally{pending.remove(activeKey,operation)}
    }
}
