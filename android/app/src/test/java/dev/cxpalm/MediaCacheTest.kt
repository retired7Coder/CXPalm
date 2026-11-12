package dev.cxpalm

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.*
import org.junit.Test

class MediaCacheTest {
    private val scope="a".repeat(64)
    private fun fixture(check: (File,(()->Long)->MediaCache)->Unit) {
        val folder=Files.createTempDirectory("cxpalm-media-test").toFile()
        val secret=KeyGenerator.getInstance("AES").apply {init(128)}.generateKey()
        val create={clock:()->Long ->MediaCache(folder,{name,bytes->
            val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret);cipher.updateAAD(name.toByteArray());cipher.iv+cipher.doFinal(bytes)
        },{name,bytes->
            val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(name.toByteArray());cipher.doFinal(bytes.copyOfRange(12,bytes.size))
        },clock)}
        try {check(folder,create)}finally{folder.deleteRecursively()}
    }
    private fun read(cache: MediaCache, fetch: (String?)->MediaResponse, owner: String=scope,item: String="item", valid: ()->Boolean={true})=
        cache.read(owner,"file","thread","turn",item,"b".repeat(64),valid,fetch)
    private fun response(text: String)=text.toByteArray().let {MediaResponse(200,it,"application/octet-stream",mediaRevision(it))}

    @Test fun encryptedCopiesSurviveRestartAndRequireVersionAndAuthorizationChecks()=fixture {folder,create->
        assertEquals("\"sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\"",mediaRevision("abc".toByteArray()))
        val cache=create(System::currentTimeMillis)
        var content=response("fixture-document-original")
        val revisions=mutableListOf<String?>()
        val fetch={revision:String? ->revisions.add(revision);if(revision==content.revision)MediaResponse(204,revision=revision) else content}
        assertArrayEquals(content.bytes,read(cache,fetch))
        val record=folder.listFiles()!!.single()
        assertFalse(String(record.readBytes(),Charsets.ISO_8859_1).contains("fixture-document-original"))
        val restarted=create(System::currentTimeMillis)
        assertArrayEquals(content.bytes,read(restarted,fetch));assertEquals(content.revision,revisions.last())
        content=response("fixture-document-modified")
        assertArrayEquals(content.bytes,read(restarted,fetch))
        read(restarted,fetch,owner="c".repeat(64));assertNull(revisions.last())
        read(restarted,fetch,item="other-item");assertNull(revisions.last())
        try {read(restarted,{MediaResponse(401)});fail("Revoked cached read succeeded")}catch(_:IllegalStateException){}
        read(restarted,fetch);assertNull(revisions.last())
        restarted.clear();assertEquals(0,folder.listFiles()!!.size)
        read(restarted,fetch);assertNull(revisions.last())
    }
    @Test fun corruptedExpiredAndDeletedCopiesAreNotUsed()=fixture {folder,create->
        var time=System.currentTimeMillis()
        val cache=create {time};val data=response("body")
        read(cache,{data})
        folder.listFiles()!!.single().writeBytes(byteArrayOf(1,2,3))
        read(cache,{assertNull(it);data})
        time+=8L*86400000;read(cache,{assertNull(it);data})
        try {read(cache,{MediaResponse(404)});fail("Deleted file was returned")}catch(_:IllegalArgumentException){}
        assertEquals(0,folder.listFiles()!!.size)
        try {read(cache,{data.copy(revision="invalid")});fail("Invalid content hash accepted")}catch(_:IllegalArgumentException){}
        try {read(cache,{data.copy(mime="text/html")});fail("HTML response accepted")}catch(_:IllegalArgumentException){}
        assertEquals(0,folder.listFiles()!!.size)
    }
    @Test fun clearAndTargetChangesFenceInflightReads()=fixture {folder,create->
        val cache=create(System::currentTimeMillis);val data=response("body")
        try {read(cache,{cache.clear();data});fail("Cleared in-flight read returned")}catch(_:IllegalArgumentException){}
        assertEquals(0,folder.listFiles()?.size?:0)
        var current=true
        try {read(cache,{current=false;data},valid={current});fail("Changed target accepted")}catch(_:IllegalArgumentException){}
        assertEquals(0,folder.listFiles()?.size?:0)
    }
    @Test fun parallelReadsSharePayloadAndCacheHasCountAndByteLimits()=fixture {folder,create->
        var time=System.currentTimeMillis()
        val cache=create {time};val data=response("parallel body")
        val start=CountDownLatch(1);val transferred=AtomicInteger()
        val pool=Executors.newFixedThreadPool(6)
        try {
            val futures=(0..5).map {pool.submit<ByteArray> {
                start.await()
                read(cache,{revision->if(revision==data.revision)MediaResponse(204,revision=revision) else {transferred.incrementAndGet();data}})
            }}
            start.countDown()
            futures.forEach {assertArrayEquals(data.bytes,it.get(5,TimeUnit.SECONDS))}
            assertEquals(1,transferred.get())
            val running=AtomicInteger();val peak=AtomicInteger()
            val distinct=(0..5).map {index->pool.submit<ByteArray> {
                read(cache,{
                    val count=running.incrementAndGet()
                    peak.accumulateAndGet(count){a,b->maxOf(a,b)}
                    try {Thread.sleep(20);data}finally{running.decrementAndGet()}
                },item="parallel-$index")
            }}
            distinct.forEach {assertArrayEquals(data.bytes,it.get(5,TimeUnit.SECONDS))}
            assertTrue(peak.get()<=2)
        }finally{pool.shutdownNow()}
        for(index in 0..25){time+=1000;read(cache,{data},item="item-$index")}
        assertEquals(24,folder.listFiles()!!.size)
        cache.clear()
        val large=ByteArray(17*1024*1024)
        val record=MediaResponse(200,large,"application/octet-stream",mediaRevision(large))
        for(index in 0..3){time+=1000;read(cache,{record},item="large-$index")}
        assertEquals(3,folder.listFiles()!!.size)
        assertTrue(folder.listFiles()!!.sumOf {it.length()}<=64L*1024*1024)
    }
}
