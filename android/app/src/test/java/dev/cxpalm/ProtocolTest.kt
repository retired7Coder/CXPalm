package dev.cxpalm

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class ProtocolTest {
    @Test fun processGroupsKeepSteeringAndFinalAnswersOutsideAndRetainMetadata() {
        val snapshot=org.json.JSONObject("""{"turns":[{"turnId":"one","status":"inProgress","items":[
            {"id":"q","type":"userMessage","text":"Question"},
            {"id":"p","type":"agentMessage","phase":"commentary","text":"Checking"},
            {"id":"r","type":"reasoning","summary":["Visible"],"content":[{"text":"PRIVATE_REASONING"}]},
            {"id":"c","type":"commandExecution","command":"git status","deferred":true,"cwd":"D:/project","exitCode":0,"durationMs":123},
            {"id":"steer","type":"userMessage","text":"Correction"},
            {"id":"f","type":"fileChange","preview":"main.go","deferred":true},
            {"id":"a","type":"agentMessage","phase":"final_answer","text":"Answer"},
            {"id":"hidden","type":"reasoning","content":[{"text":"PRIVATE_REASONING"}]}
        ]}]}""")
        val messages=conversationMessages(snapshot)
        val rows=conversationRows(messages)
        assertEquals(listOf("You","processGroup","You","processGroup","Codex"),rows.map {it.role})
        assertEquals(listOf("one:p","one:r","one:c"),rows[1].items.map {it.id})
        assertEquals("inProgress",rows[1].status)
        assertEquals("D:/project",rows[1].items.last().cwd)
        assertEquals(0,rows[1].items.last().exitCode)
        org.junit.Assert.assertFalse(messages.any {it.text.contains("PRIVATE_REASONING")})
        val completed=conversationRows(messages.map {it.copy(turnStatus="completed")})
        assertEquals(rows[1].id,completed[1].id)
        assertEquals("completed",completed[1].status)
        assertEquals(2,questionMessageIndex(org.json.JSONObject("""{"turn":"one","item":"steer"}"""),rows))
        assertEquals(setOf(4),timingFooterIndices(rows))
    }
    @Test fun outputOnlyMessagesRetainFileIdentity() {
        val file=org.json.JSONObject().put("id","a".repeat(64)).put("name","review.xlsx").put("kind","xlsx")
        val item=org.json.JSONObject().put("id","output").put("type","agentMessage").put("files",org.json.JSONArray().put(file))
        val snapshot=org.json.JSONObject().put("turns",org.json.JSONArray().put(org.json.JSONObject().put("turnId","turn").put("items",org.json.JSONArray().put(item))))
        val message=conversationMessages(snapshot).single()
        assertEquals("turn:output",message.id);assertEquals("review.xlsx",message.files.single().name)
        assertEquals("a".repeat(64),message.files.single().id)
        assertEquals(0,returnedFileBytes(java.io.ByteArrayInputStream(byteArrayOf())).size)
        assertEquals("fixture",String(returnedFileBytes(java.io.ByteArrayInputStream("fixture".toByteArray()))))
        try {returnedFileBytes(java.io.ByteArrayInputStream(ByteArray(MAX_ATTACHMENT_SIZE.toInt()+1)));fail("Oversized download accepted")}
        catch(_:IllegalArgumentException) {}
    }
    @Test fun sessionErrorsAreVisibleAndScopedToTheirTurn() {
        val snapshot=org.json.JSONObject("""{"turns":[{"turnId":"failed","items":[{"id":"cxpalm:turn-error","type":"sessionError","text":"HTTP 429 <img src=x> **plain**","status":"failed"}]},{"turnId":"ok","items":[]}]}""")
        val messages=conversationMessages(snapshot)
        assertEquals(1,messages.size);assertEquals("failed",messages.single().turn)
        assertEquals("sessionError",messages.single().role);org.junit.Assert.assertFalse(messages.single().collapsible)
        assertEquals("HTTP 429 <img src=x> **plain**",messages.single().text)
        org.junit.Assert.assertTrue(conversationMessages(org.json.JSONObject("""{"turns":[{"turnId":"ok","items":[]}]}""")).isEmpty())
    }
    @Test fun onlyMatchingTerminalReceiptsReleasePendingSend() {
        val receipt=org.json.JSONObject().put("id","original")
        for(status in listOf("confirmed","acknowledged","not_sent","rejected")) {
            receipt.put("status",status)
            org.junit.Assert.assertTrue(settlesPending("original",receipt))
            org.junit.Assert.assertFalse(settlesPending("newer",receipt))
            org.junit.Assert.assertFalse(settlesPending(null,receipt))
        }
        for(status in listOf("dispatched","unknown","","unsupported")) {
            receipt.put("status",status)
            org.junit.Assert.assertFalse(settlesPending("original",receipt))
        }
    }
    @Test fun syncNoticeAppearsOnlyForAnActualConnectedError() {
        val healthy=org.json.JSONObject("""{"total":19,"checked":19,"live":13,"scanning":false}""")
        org.junit.Assert.assertNull(sessionSyncIssue(healthy,true))
        healthy.put("scanning",true);org.junit.Assert.assertNull(sessionSyncIssue(healthy,true))
        healthy.put("error"," list failed ");assertEquals("list failed",sessionSyncIssue(healthy,true))
        org.junit.Assert.assertNull(sessionSyncIssue(healthy,false))
        org.junit.Assert.assertNull(sessionSyncIssue(null,true))
    }

    @Test fun sharedReceiptRequiresVisibleCurrentForegroundReply() {
        val snapshot=org.json.JSONObject("""{"hasUnreadTurn":true,"threadRuntimeStatus":{"type":"idle"}}""")
        val state=ViewState(thread="a",connected=true,desktopConnected=true,sharedReadSync=true,readToken="a".repeat(64),snapshot=snapshot)
        org.junit.Assert.assertTrue(readReceiptEligible(state,true,true))
        snapshot.put("officialReadSyncAvailable",false)
        org.junit.Assert.assertTrue(readReceiptEligible(state,true,true))
        snapshot.put("readSyncAvailable",false)
        org.junit.Assert.assertFalse(readReceiptEligible(state,true,true))
        snapshot.put("readSyncAvailable",true)
        org.junit.Assert.assertTrue(readReceiptEligible(state,true,true))
        for(candidate in listOf(state.copy(sharedReadSync=false),state.copy(connected=false),state.copy(desktopConnected=false),state.copy(readToken=""),state.copy(historyPage=org.json.JSONObject()))) {
            org.junit.Assert.assertFalse(readReceiptEligible(candidate,true,true))
        }
        org.junit.Assert.assertTrue(readReceiptEligible(state.copy(historyPage=org.json.JSONObject("""{"hasMore":false}""")),true,true))
        org.junit.Assert.assertFalse(readReceiptEligible(state.copy(historyPage=org.json.JSONObject("""{"hasMore":true}""")),true,true))
        org.junit.Assert.assertFalse(readReceiptEligible(state,false,true))
        org.junit.Assert.assertFalse(readReceiptEligible(state,true,false))
        snapshot.getJSONObject("threadRuntimeStatus").put("type","active")
        org.junit.Assert.assertTrue(readReceiptEligible(state,true,true))
        val data=org.json.JSONObject().put("id","a").put("connected",true).put("sequence",1).put("readToken","b".repeat(64)).put("snapshot",snapshot)
        assertEquals("b".repeat(64),synchronizedChatState(state,data).readToken)
    }

    @Test fun originAcceptsOnlySecureRoot() {
        assertEquals("https://cx.example", normalizeOrigin("https://cx.example/"))
        for (input in listOf("http://cx.example", "https://user:pass@cx.example", "https://cx.example/path", "https://cx.example?token=x")) {
            try { normalizeOrigin(input); fail("Accepted $input") } catch (_: IllegalArgumentException) { }
        }
    }
    @org.junit.Test fun missingItemIDsStillHaveStableUniqueKeys() {
        val snapshot=org.json.JSONObject("""{"turns":[{"items":[{"type":"agentMessage","text":"a"},{"type":"agentMessage","text":"b"}]},{"items":[{"type":"agentMessage","text":"c"}]}]}""")
        val keys=conversationMessages(snapshot).map { it.id }
        org.junit.Assert.assertEquals(3, keys.toSet().size)
        org.junit.Assert.assertEquals(keys, conversationMessages(snapshot).map { it.id })
    }
    @Test fun liveStateIsOrderedAndOfflineTextDoesNotEnableWrites() {
        val snapshot=org.json.JSONObject("""{"threadRuntimeStatus":{"type":"active"}}""")
        val live=ViewState(thread="a",connected=true,desktopConnected=true,snapshot=snapshot,sequence=9)
        val stale=org.json.JSONObject("""{"id":"a","sequence":8,"connected":false}""")
        org.junit.Assert.assertSame(live,synchronizedChatState(live,stale))
        val offline=synchronizedChatState(live,org.json.JSONObject("""{"id":"a","sequence":10,"connected":false}"""))
        org.junit.Assert.assertSame(snapshot,offline.snapshot)
        org.junit.Assert.assertFalse(offline.desktopConnected)
        org.junit.Assert.assertSame(offline,synchronizedChatState(offline,org.json.JSONObject("""{"id":"b","sequence":99,"connected":true}""")))
    }
    @Test fun fullHistoricalPageKeepsLongTextAndStableQuestionTarget() {
        val text="完整内容".repeat(6000)
        val snapshot=org.json.JSONObject().put("turns",org.json.JSONArray().put(org.json.JSONObject().put("turnId","early-turn").put("items",org.json.JSONArray()
            .put(org.json.JSONObject().put("id","q").put("type","userMessage").put("text","first question"))
            .put(org.json.JSONObject().put("id","a").put("type","agentMessage").put("text",text)))))
        val messages=conversationMessages(snapshot)
        assertEquals(2,messages.size)
        assertEquals("early-turn:q",messages[0].id)
        assertEquals(text,messages[1].text)
        org.junit.Assert.assertFalse(messages[1].truncated)
    }

    @Test fun liveEventsDoNotDisplaceHistoricalReadingWindow() {
        val historical=org.json.JSONObject("""{"offset":0,"turns":[{"turnId":"early","items":[]}]}""")
        val state=ViewState(thread="chat",connected=true,sequence=1,historyPage=historical)
        val next=synchronizedChatState(state,org.json.JSONObject("""{"id":"chat","sequence":2,"connected":true,"snapshot":{"turns":[{"turnId":"new","items":[]}]}}"""))
        org.junit.Assert.assertSame(historical,next.historyPage)
        assertEquals("new",next.snapshot?.getJSONArray("turns")?.getJSONObject(0)?.getString("turnId"))
    }

}
