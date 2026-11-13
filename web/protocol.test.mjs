import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotStream,Bridge, conversation, approvalDecisions, contextUsage, StateSequence, mergeSessionReadState, NotificationInbox, sessionSettings, changedSettings, newChatDefaults, turnElapsed, sessionElapsed, activeQuestionIndex, computerAddress, extendHistory, mergeHistoryTurns, sessionIndicator, effortLabel, ReadingCache, MediaCache, offlineReading, connectionPresentation, operationLabel, AttachmentUploads, activeTurnId} from './protocol-v1.mjs';

test('confirmed chat reads update the list and cannot be undone by an older list page',()=>{
  const old={id:'chat',live:true,sequence:10,unread:true,readToken:'reply'};
  const confirmed={...old,sequence:11,unread:false};
  const remembered=mergeSessionReadState({id:'chat'},confirmed);
  assert.equal(mergeSessionReadState(old,remembered).unread,false);
  assert.equal(mergeSessionReadState(old,confirmed).unread,false);
  assert.equal(mergeSessionReadState(confirmed,old),confirmed);
  const newer={...old,sequence:12};
  assert.equal(mergeSessionReadState(newer,confirmed),newer,'new native unread state was hidden');
  for(const row of [{...old,id:'other'},{...old,live:false,unread:null},{...old,archived:true}])assert.equal(mergeSessionReadState(row,confirmed),row);
  for(const update of [{...confirmed,live:false},{...confirmed,unread:null},{...confirmed,sequence:undefined}])assert.equal(mergeSessionReadState(old,update),old);
});

function mediaFixture() {
  const entries=new Map(),requests=[];
  const storage={open:async()=>({
    keys:async()=>[...entries.keys()].map(url=>new Request(url)),
    match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone(),
    put:async(key,response)=>entries.set(typeof key==='string'?key:key.url,response.clone()),
    delete:async key=>entries.delete(typeof key==='string'?key:key.url),
  })};
  let value='original document',status=200,clock=Date.now(),release;
  const cache=new MediaCache({storage,origin:'https://fixture.example',now:()=>clock,request:async(url,options)=>{
    requests.push({url,...options});if(release)await release;
    if(status!==200)return new Response(null,{status});
    const blob=new Blob([value],{type:url.endsWith('/image')?'image/png':'application/octet-stream'});
    const etag=`"sha256-${await cache.digest(blob)}"`;
    if(options.headers['X-CXPalm-Revision']===etag)return new Response(null,{status:204,headers:{ETag:etag}});
    return new Response(blob,{headers:{'Content-Type':blob.type,ETag:etag}});
  }});
  const fields={thread:'thread',turn:'turn',item:'item',file:'a'.repeat(64)};
  return {cache,entries,requests,fields,storage,setValue:v=>value=v,setStatus:v=>status=v,advance:v=>clock+=v,
    hold:()=>{let done;release=new Promise(resolve=>done=resolve);return()=>{release=null;done();};}};
}
test('media cache survives reload, revalidates access, refreshes changed contents, and clears without replay',async()=>{
  const f=mediaFixture();
  assert.equal(await (await f.cache.read('scope','file',f.fields)).text(),'original document');
  assert.equal(f.requests[0].headers['X-CXPalm-Revision'],undefined);
  const loaded=new MediaCache({storage:f.storage,origin:'https://fixture.example',request:f.cache.request});
  assert.equal(await (await loaded.read('scope','file',f.fields)).text(),'original document');
  assert.match(f.requests[1].headers['X-CXPalm-Revision'],/^"sha256-/);
  f.setValue('modified document');
  assert.equal(await (await loaded.read('scope','file',f.fields)).text(),'modified document');
  await loaded.read('other-authorization','file',f.fields);
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  await loaded.read('scope','file',{...f.fields,thread:'other-thread'});
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  f.setStatus(401);await assert.rejects(loaded.read('scope','file',f.fields),/授权/);
  f.setStatus(200);await loaded.read('scope','file',f.fields);
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  await loaded.clear();
  assert.equal(f.entries.size,0);
  await loaded.read('scope','file',f.fields);
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  assert(f.requests.every(r=>r.method==='POST'&&r.cache==='no-store'&&r.redirect==='error'));
});
test('media cache coalesces reads and never restores cleared or switched requests',async()=>{
  const f=mediaFixture(),release=f.hold();
  const first=f.cache.read('scope','file',f.fields),second=f.cache.read('scope','file',f.fields);
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setTimeout(resolve,10));
  release();
  assert.equal(await (await first).text(),await (await second).text());
  assert.equal(f.requests.length,1);
  const unblock=f.hold(),pending=f.cache.read('scope','file',{...f.fields,file:'b'.repeat(64)});
  await new Promise(resolve=>setTimeout(resolve,10));
  await f.cache.clear();unblock();
  await assert.rejects(pending,/改变/);
  assert.equal(f.entries.size,0);
  let valid=true;const end=f.hold(),switched=f.cache.read('scope','file',f.fields,()=>valid);
  await new Promise(resolve=>setTimeout(resolve,10));valid=false;end();
  await assert.rejects(switched,/改变/);
  assert.equal(f.entries.size,0);
});
test('media cache rejects corrupt, expired, removed and incorrectly typed copies',async()=>{
  const f=mediaFixture();
  await f.cache.read('scope','file',f.fields);
  const [key,response]=[...f.entries][0];
  f.entries.set(key,new Response('corrupt',{headers:response.headers}));
  await f.cache.read('scope','file',f.fields);
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  f.advance(8*86400000);await f.cache.read('scope','file',f.fields);
  assert.equal(f.requests.at(-1).headers['X-CXPalm-Revision'],undefined);
  f.setStatus(404);await assert.rejects(f.cache.read('scope','file',f.fields),/HTTP 404/);
  assert.equal(f.entries.size,0);
  const invalid=new MediaCache({request:async()=>new Response('<script>bad()</script>',{headers:{'Content-Type':'text/html'}})});
  await assert.rejects(invalid.read('scope','file',f.fields),/类型/);
});
test('media cache bounds retained entry count and total bytes and works without disk storage',async()=>{
  const f=mediaFixture();
  for(let index=0;index<26;index++){f.advance(1000);await f.cache.read('scope','file',{...f.fields,item:String(index)});}
  assert.equal(f.entries.size,24);
  await f.cache.clear();
  f.setValue('x'.repeat(17*1024*1024));
  for(let index=0;index<4;index++){f.advance(1000);await f.cache.read('scope','file',{...f.fields,item:String(index)});}
  assert.equal(f.entries.size,3);
  assert([...f.entries.values()].reduce((total,r)=>total+Number(r.headers.get('X-CXPalm-Size')),0)<=64*1024*1024);
  const memory=new MediaCache({storage:{open:async()=>{throw Error('blocked');}},request:f.cache.request});
  await memory.read('scope','file',f.fields);await memory.read('scope','file',f.fields);
  assert.match(f.requests.at(-1).headers['X-CXPalm-Revision'],/^"sha256-/);
});

test('output-only messages retain bounded file identities without manufacturing local URLs',()=>{
  const file={id:'a'.repeat(64),name:'review.xlsx',kind:'xlsx'};
  const messages=conversation([{turnId:'turn',items:[{id:'output',type:'agentMessage',text:'',files:[file]}]}]);
  assert.equal(messages.length,1);assert.deepEqual(messages[0].files,[file]);
  assert.equal(messages[0].turn,'turn');assert.equal(messages[0].id,'output');
});
test('guidance and question navigation retain the exact active turn and same-turn message identity',()=>{
  assert.equal(activeTurnId({turns:[{turnId:'finished',status:'completed'},{turnId:'live',status:'inProgress'}]}),'live');
  assert.equal(activeTurnId({turns:[{id:'flat',status:'inProgress'}]}),'flat');
  assert.equal(activeTurnId({turns:[]}),'');
  const questions=[{turn:'same',item:'original'},{turn:'same',item:'steer:one'},{turn:'same',item:'steer:two'}];
  const positions=[{turn:'same',item:'original',top:-500},{turn:'same',item:'steer:one',top:-100},{turn:'same',item:'steer:two',top:400}];
  assert.equal(activeQuestionIndex(questions,positions,20,false,false),1);
  assert.equal(activeQuestionIndex(questions,positions,500,false,false),2);
});

test('connection presentation distinguishes gateway, native state and write authority without using heartbeat time',()=>{
  const selected={id:'thread'},base={device:{id:'device'},selected,connected:true,desktop:true,writable:true,nativeSyncedAtMs:1234};
  assert.equal(connectionPresentation({}).label,'未登录');
  assert.equal(connectionPresentation({...base,connected:false,connecting:'connecting'}).label,'正在连接网关');
  assert.equal(connectionPresentation({...base,connected:false,cached:true,connecting:'reconnecting'}).label,'正在重连网关');
  assert.equal(connectionPresentation({...base,selected:null,writable:false}).label,'网关已连接 · 请选择会话');
  assert.equal(connectionPresentation({...base,desktop:false,writable:false}).label,'正在同步官方桌面');
  assert.equal(connectionPresentation({...base,connected:false,cached:true,writable:false}).label,'离线只读');
  assert.equal(connectionPresentation({...base,selected:{...selected,archived:true},writable:false}).label,'已归档 · 只读');
  assert.equal(connectionPresentation({...base,pending:{id:'old'},writable:false}).label,'已连接 · 操作待核对');
  assert.equal(connectionPresentation(base).label,'可发送');
  assert.equal(connectionPresentation({...base,nativeSyncedAtMs:undefined,observedAtMs:9999,lastHeartbeatAt:9999}).nativeSyncedAtMs,null);
  assert.equal(connectionPresentation({...base,connected:false,cached:true,observedAtMs:9999}).nativeSyncedAtMs,1234);
  for(const method of ['chat.send','chat.steer','chat.queue','sessions.rename','chat.approve'])assert.notEqual(operationLabel(method),method);
  assert.equal(operationLabel('future.method'),'会话操作');
});

function uploadFixture(options={}){
  const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const saved=[],requests=[];let authorized=true;
  const manager=new AttachmentUploads({storage,request:async(url,request)=>{requests.push({url,...request});return new Response(JSON.stringify({id:'a'.repeat(64),name:'fixture.txt',size:3}),{status:201});},...options});
  return {manager,data,saved,requests,options:{thread:'thread',valid:()=>authorized,saved:value=>saved.push(value)},revoke(){authorized=false;manager.cancelAll();}};
}
test('attachment uploads retain scoped file status and cancellation never attaches a late response',async()=>{
  let complete;
  const fixture=uploadFixture({request:()=>new Promise(resolve=>{complete=resolve;})});
  const upload=fixture.manager.upload('device:thread',[new File(['abc'],'fixture.txt')],fixture.options);
  assert.equal(fixture.manager.list('device:thread')[0].status,'uploading');
  assert.equal(fixture.manager.busy('other-device:thread'),false);
  fixture.manager.cancel(fixture.manager.list('device:thread')[0].id);
  complete(new Response(JSON.stringify({id:'a'.repeat(64),name:'fixture.txt',size:3}),{status:201}));
  await upload;
  assert.equal(fixture.saved.length,0);assert.equal(fixture.manager.busy('device:thread'),false);
  assert.equal(fixture.manager.list('device:thread')[0].status,'cancelled');
  assert.match(fixture.manager.list('device:thread')[0].error,/电脑可能已收到文件/);
  fixture.manager.dismiss(fixture.manager.list('device:thread')[0].id);assert.equal(fixture.manager.list('device:thread').length,0);
});
test('authorization changes cancel queued uploads before any next request and never retry',async()=>{
  let complete,requests=0;
  const fixture=uploadFixture({request:()=>{requests++;return new Promise(resolve=>{complete=resolve;});}});
  const upload=fixture.manager.upload('device:thread',[new File(['abc'],'one.txt'),new File(['def'],'two.txt')],fixture.options);
  fixture.revoke();complete(new Response(JSON.stringify({id:'a'.repeat(64),name:'one.txt',size:3}),{status:201}));await upload;
  assert.equal(requests,1);assert.equal(fixture.saved.length,0);assert(fixture.manager.list('device:thread').every(job=>job.status==='cancelled'));
});
test('upload timeout and restored unfinished uploads remain visible without automatic resend',async()=>{
  let requests=0;
  const fixture=uploadFixture({timeout:5,request:(_url,request)=>{requests++;return new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason)));}});
  await assert.rejects(fixture.manager.upload('device:thread',[new File(['abc'],'timeout.txt')],fixture.options),/上传超时/);
  assert.equal(requests,1);assert.equal(fixture.manager.list('device:thread')[0].status,'failed');
  fixture.data.set('cxpalm:upload-status:device:other',JSON.stringify([{id:'interrupted',name:'old.txt',size:3,status:'uploading'}]));
  assert.equal(fixture.manager.list('device:other')[0].status,'interrupted');
  assert.equal(fixture.manager.busy('device:other'),false);assert.equal(requests,1);
});
test('uploaded files are saved exactly once in their original scope',async()=>{
  const fixture=uploadFixture();
  await fixture.manager.upload('device:thread',[new File(['abc'],'fixture.txt')],fixture.options);
  assert.equal(fixture.saved.length,1);assert.equal(fixture.requests.length,1);assert.equal(fixture.manager.list('device:thread').length,0);
  assert.equal(fixture.requests[0].credentials,'same-origin');assert.equal(fixture.requests[0].redirect,'error');
});

test('new chat defaults contain only settings and explicit notification preference, never approvals',()=>{
  const snapshot={latestModel:'fixture',latestReasoningEffort:'high',latestThreadSettings:{permissions:':workspace',approvalsReviewer:'auto_review'},notificationPreference:{enabled:true},requests:[{id:'private',decision:'acceptForSession'}],turns:[{}],controlsRevision:'old'};
  assert.deepEqual(newChatDefaults(snapshot),{options:{model:'fixture',effort:'high',permission:'auto-review'},enabled:true});
  assert.deepEqual(newChatDefaults({...snapshot,notificationPreference:{available:false,enabled:false}}),{options:{model:'fixture',effort:'high',permission:'auto-review'}});
  assert.equal(newChatDefaults({}),null);
  assert.equal(newChatDefaults({...snapshot,latestThreadSettings:{permissions:'custom'}}),null);
});

const secret = 'a'.repeat(64);
test('session errors remain visible non-collapsible messages scoped to their original turn',()=>{
 const turns=[{turnId:'failed',items:[{id:'cxpalm:turn-error',type:'sessionError',text:'HTTP 429 <img src=x> **plain**',status:'failed'}]},{turnId:'ok',items:[]}];
 const messages=conversation(turns);
 assert.equal(messages.length,1);assert.equal(messages[0].turn,'failed');assert.equal(messages[0].role,'sessionError');assert.equal(messages[0].collapsible,false);
 assert.equal(messages[0].text,'HTTP 429 <img src=x> **plain**');
 assert.deepEqual(conversation([{turnId:'ok',items:[]}]),[]);
});
test('permission approvals stay turn-scoped and unsupported choices fail closed',()=>{
  const request={method:'item/permissions/requestApproval',params:{permissions:{network:{enabled:true}}}};
  assert.deepEqual(approvalDecisions(request),['accept','decline']);
  assert.deepEqual(approvalDecisions({...request,params:{permissions:{future:true}}}),['decline']);
  assert.deepEqual(approvalDecisions({...request,params:{}}),[]);
  for(const availableDecisions of [[],{},[{acceptForSession:{}}]])assert.deepEqual(approvalDecisions({method:'item/commandExecution/requestApproval',params:{availableDecisions}}),[]);
  assert.deepEqual(approvalDecisions({method:'item/commandExecution/requestApproval',params:{availableDecisions:null}}),['accept','decline']);
  assert.deepEqual(approvalDecisions({method:'item/fileChange/requestApproval',params:{availableDecisions:['cancel']}}),['cancel']);
});
test('MCP tool confirmation accepts only an empty typed form and never auth challenges',()=>{
 const params={threadId:'synthetic',mode:'form',_meta:{codex_approval_kind:'mcp_tool_call',persist:['session','always']},requestedSchema:{type:'object',properties:{}}};
 const choices=p=>approvalDecisions({method:'mcpServer/elicitation/request',params:p});
 assert.deepEqual(choices(params),['accept','acceptForSession','decline','cancel']);
 for(const persist of ['session',['session']])assert(choices({...params,_meta:{...params._meta,persist}}).includes('acceptForSession'));
 for(const persist of [undefined,null,'always',['always'],true,{},[{}]])assert(!choices({...params,_meta:{...params._meta,persist}}).includes('acceptForSession'));
 assert.deepEqual(approvalDecisions({method:'item/commandExecution/requestApproval',params:{availableDecisions:['acceptForSession','decline']}}),['acceptForSession','decline']);
 for(const changed of [{mode:'url'},{mode:'openai/userVerification'},{_meta:{codex_approval_kind:'browser_auth'}},{_meta:{}},{requestedSchema:{type:'object',properties:{answer:{type:'string'}}}},{requestedSchema:{type:'object',properties:{},required:['answer']}},{requestedSchema:{type:'object',properties:{},allOf:[]}}])assert.deepEqual(choices({...params,...changed}),[]);
});
test('conversation preserves text as text and approval choices fail closed', () => {
  const messages = conversation([{items:[{type:'userMessage',content:[{text:'<img onerror=alert(1)>'}]},
    {type:'agentMessage',text:'```js\ncode\n```',truncated:true},{type:'commandExecution',aggregatedOutput:'output'}]}]);
  assert.equal(messages[0].text, '<img onerror=alert(1)>');
  assert.equal(messages[1].truncated, true);
  assert.equal(messages[2].text, 'output');
  assert.deepEqual(approvalDecisions({method:'unknown/request'}), []);
  assert.deepEqual(approvalDecisions({method:'item/commandExecution/requestApproval',params:{availableDecisions:['decline']}}), ['decline']);
});

function fixture(existingStorage) {
  const data = existingStorage || new Map();
  const storage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const sockets=[];
  const bridge = new Bridge({storage,lock:async(_name,action)=>action(true),digest:async text=>`hash:${text}`,
    socket:()=>{const socket={readyState:1,sent:[],send(value){this.sent.push(JSON.parse(value));},close(){}};sockets.push(socket);return socket;}});
  bridge.connect({id:'device'});
  const hello=()=>sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:'device'}})});
  hello();
  const reply=(type,value)=>{const socket=sockets.at(-1),last=socket.sent.at(-1);socket.onmessage({data:JSON.stringify({id:last.id,type,[type==='error'?'error':'data']:value})});};
  return {bridge,data,sockets,reply,hello};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('connection changes during digest or a queued write lock never dispatch old commands',async()=>{
  for(const stage of ['digest','lock']) for(const replacement of ['device','replacement']) {
    const {bridge,sockets}=fixture();
    let release;
    if(stage==='digest')bridge.digest=()=>new Promise(resolve=>{release=resolve;});
    else bridge.lock=(_key,action)=>new Promise(resolve=>{release=()=>resolve(action(true));});
    const operation=bridge.mutate('chat.send',{thread:'old-thread',text:'old draft'},{key:bridge.draftKey('old-thread'),text:'old draft'});
    const rejection=assert.rejects(operation,/连接已改变/);
    await tick();
    bridge.connect({id:replacement});
    sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:replacement}})});
    release('digest');await rejection;
    assert.equal(sockets.flatMap(socket=>socket.sent).length,0);
    assert.equal(bridge.storage.getItem('cxpalm:pending:device'),null);
    assert.equal(bridge.pending,null);
    bridge.disconnect();
  }
});
test('a connection change after reservation settles only the original unsent operation',async()=>{
  const {bridge,sockets}=fixture();let switchAfterReservation=true;
  bridge.lock=async(_key,action)=>{
    const result=await action(true);
    if(switchAfterReservation){switchAfterReservation=false;bridge.connect({id:'replacement'});sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:'replacement'}})});}
    return result;
  };
  await assert.rejects(bridge.mutate('chat.send',{thread:'old-thread',text:'old draft'}),/连接已改变/);
  assert.equal(sockets.flatMap(socket=>socket.sent).length,0);
  assert.equal(bridge.storage.getItem('cxpalm:pending:device'),null);
  assert.equal(bridge.pending,null);assert.equal(bridge.noticeFor('old-thread'),null);
  bridge.disconnect();
});
test('late receipt processing keeps its original device journal across an awaited digest',async()=>{
  const {bridge,sockets}=fixture();const original=bridge.device;
  const draftKey=bridge.draftKey('old-thread');bridge.storage.setItem(draftKey,'original');
  bridge.savePending({id:'original-operation',thread:'old-thread',draftKey,draftDigest:'hash:original'});
  let release;bridge.digest=()=>new Promise(resolve=>{release=resolve;});
  const applied=bridge.applyReceipt({id:'original-operation',status:'confirmed'});await tick();
  bridge.connect({id:'replacement'});sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:'replacement'}})});
  bridge.savePending({id:'replacement-operation',thread:'new-thread'});
  release('hash:original');await applied;
  assert.equal(bridge.storage.getItem(`cxpalm:pending:${original.id}`),null);
  assert.equal(bridge.pending.id,'replacement-operation');assert.equal(bridge.receipt,null);
  assert.equal(bridge.receiptThread,null);
  assert.equal(bridge.storage.getItem(draftKey),null);bridge.disconnect();
});
test('acknowledgement never crosses a connection change while checking the original receipt',async()=>{
  const {bridge,sockets,reply}=fixture();
  bridge.savePending({id:'unknown-operation',thread:'old-thread'});
  bridge.lock=async(_key,action)=>{
    const result=await action(true);
    bridge.connect({id:'replacement'});sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:'replacement'}})});
    return result;
  };
  const acknowledgement=bridge.acknowledge('unknown-operation');
  const rejection=assert.rejects(acknowledgement,/连接已改变/);await tick();
  reply('result',{id:'unknown-operation',status:'unknown'});await rejection;
  assert.deepEqual(sockets.flatMap(socket=>socket.sent).map(command=>command.method),['operation.get']);
  assert.equal(JSON.parse(bridge.storage.getItem('cxpalm:pending:device'))[0].receipt.status,'unknown');
  assert.equal(bridge.pending,null);bridge.disconnect();
});
test('explicit rejection releases only the matching scope and keeps a local failure notice and drafts',async()=>{
  const {bridge,sockets,reply}=fixture();
  const key=bridge.draftKey('a');bridge.storage.setItem(key,'retained');
  const archive=bridge.mutate('sessions.archive',{thread:'a'});await tick();const id=bridge.pendingFor('a').id;
  reply('result',{id,status:'rejected',result:{code:'active_writer',error:'Archive not executed; use the official desktop'}});await archive;
  assert.equal(bridge.pendingFor('a'),null);assert.equal(bridge.noticeFor('a').receipt.status,'rejected');
  assert.equal(bridge.noticeFor('b'),null);assert.equal(bridge.storage.getItem(key),'retained');
  assert.equal(sockets[0].sent.filter(q=>q.method==='sessions.archive').length,1);
  bridge.dismissFailure(id);assert.equal(bridge.noticeFor('a'),null);
  const send=bridge.mutate('chat.send',{thread:'a',text:'retained'},{key,text:'retained'});await tick();
  reply('result',{id:bridge.pendingFor('a').id,status:'not_sent'});await send;
  assert.equal(bridge.storage.getItem(key),'retained');assert.equal(bridge.noticeFor('a').receipt.status,'not_sent');
});
test('unknown archive locks only its conversation, including across tabs and reloads',async()=>{
  const {bridge,data,sockets,reply}=fixture();
  let locked=false;
  bridge.lock=async(_key,action)=>{if(locked)return action(false);locked=true;try{return await action(true);}finally{locked=false;}};
  const archive=bridge.mutate('sessions.archive',{thread:'a'});await tick();
  const a=bridge.pendingFor('a').id;
  // A network round trip must not hold the storage lock for every conversation.
  const send=bridge.mutate('chat.send',{thread:'b',text:'independent'});await tick();
  const b=bridge.pendingFor('b').id;
  assert.equal(sockets[0].sent.length,2);
  reply('result',{id:b,status:'confirmed'});await send;
  sockets[0].onmessage({data:JSON.stringify({id:a,type:'result',data:{id:a,status:'unknown',result:{error:'active writer'}}})});await archive;
  assert.equal(bridge.pendingFor('b'),null);
  assert.equal(bridge.receiptFor(bridge.pendingFor('a')).result.error,'active writer');
  const next=fixture(data);
  await assert.rejects(next.bridge.mutate('sessions.rename',{thread:'a',text:'duplicate'}),/未确认/);
  assert.equal(next.sockets[0].sent.length,0);
  const create=next.bridge.mutate('sessions.create',{project:'none'});await tick();
  next.reply('result',{id:next.bridge.pendingFor(null).id,status:'unknown'});await create;
  const ack=next.bridge.acknowledge(a);await tick();next.reply('result',{id:a,status:'unknown'});await tick();
  next.reply('result',{id:a,status:'acknowledged'});await ack;
  assert.equal(next.bridge.pendingFor('a'),null);
  assert.ok(next.bridge.pendingFor(null));
  assert.equal(next.sockets[0].sent.filter(op=>op.method==='sessions.archive').length,0);
});
test('legacy web pending records keep their original thread affinity',async()=>{
  const data=new Map([['cxpalm:pending:device',JSON.stringify({id:'old',thread:'a',method:'sessions.archive'})]]);
  const {bridge,reply}=fixture(data);
  assert.equal(bridge.pendingFor('a').id,'old');assert.equal(bridge.pendingFor('b'),null);
  const operation=bridge.mutate('chat.send',{thread:'b',text:'new'});await tick();
  reply('result',{id:bridge.pendingFor('b').id,status:'not_sent'});await operation;
  assert.equal(bridge.pendingFor('a').id,'old');assert.equal(bridge.pendingFor('b'),null);
});
test('fenced not-sent receipt releases a stranded pending send without losing draft or attachments', async () => {
  const {bridge,sockets,reply}=fixture();
  const key=bridge.draftKey('thread'),files='cxpalm:attachments:device:thread';
  bridge.storage.setItem(key,'retained draft');bridge.storage.setItem(files,JSON.stringify([{id:'file'}]));
  const operation=bridge.mutate('chat.send',{thread:'thread',text:'retained draft',attachments:['file']},{key,text:'retained draft'});
  await tick();const id=bridge.pending.id;
  sockets[0].onclose();await assert.rejects(operation,/中断/);
  bridge.connect({id:'device'});sockets.at(-1).onmessage({data:JSON.stringify({type:'hello',data:{device:'device'}})});
  const check=bridge.checkPending();await tick();
  assert.equal(sockets.at(-1).sent.at(-1).method,'operation.get');
  reply('result',{id,status:'not_sent'});await check;
  assert.equal(bridge.pending,null);assert.equal(bridge.storage.getItem(key),'retained draft');
  assert.deepEqual(JSON.parse(bridge.storage.getItem(files)),[{id:'file'}]);
  assert.equal(sockets.at(-1).sent.filter(q=>q.method==='chat.send').length,0);
});
test('attachment-only messages clear only confirmed attachment IDs, never newer files', async () => {
  const {bridge,sockets,reply}=fixture();
  const key='cxpalm:attachments:device:thread';
  bridge.storage.setItem(key,JSON.stringify([{id:'original'},{id:'newer'}]));
  const operation=bridge.mutate('chat.send',{thread:'thread',text:'',attachments:['original']});
  await tick();
  assert.deepEqual(sockets[0].sent[0].attachments,['original']);
  reply('result',{id:bridge.pending.id,status:'confirmed'});await operation;
  assert.deepEqual(JSON.parse(bridge.storage.getItem(key)),[{id:'newer'}]);
  const uncertain=bridge.mutate('chat.steer',{thread:'thread',text:'',attachments:['newer']});await tick();
  reply('result',{id:bridge.pending.id,status:'unknown'});await uncertain;
  assert.deepEqual(JSON.parse(bridge.storage.getItem(key)),[{id:'newer'}]);
});
test('writes persist before send and confirmed receipt clears only matching draft', async () => {
  const {bridge,sockets,reply}=fixture();
  const key=bridge.draftKey('thread');bridge.storage.setItem(key,'hello');
  const operation=bridge.mutate('chat.send',{thread:'thread',text:'hello'},{key,text:'hello'});
  await tick();
  const command=sockets[0].sent[0];assert.equal(bridge.pending.id,command.id);
  assert.equal(command.method,'chat.send');
  reply('result',{id:command.id,status:'confirmed'});
  await operation;
  assert.equal(bridge.pending,null);assert.equal(bridge.storage.getItem(key),null);
});
test('uncertain disconnect survives reload, reconnect does not replay, unknown requires explicit acknowledgement', async () => {
  const {bridge,data,sockets}=fixture();
  const operation=bridge.mutate('chat.send',{thread:'thread',text:'hello'});
  await tick();
  const original=bridge.pending.id;
  sockets[0].onclose();await assert.rejects(operation,/中断/);
  const next=fixture(data);assert.equal(next.bridge.pending.id,original);assert.equal(next.sockets[0].sent.length,0);
  await assert.rejects(next.bridge.mutate('chat.send',{thread:'thread',text:'hello'}),/未确认/);
  const check=next.bridge.checkPending();await tick();
  assert.equal(next.sockets[0].sent[0].method,'operation.get');
  next.reply('result',{id:original,status:'unknown'});await check;
  assert.equal(next.bridge.pending.id,original);
  const ack=next.bridge.acknowledge();await tick();next.reply('result',{id:original,status:'unknown'});
  await tick();assert.equal(next.sockets[0].sent.at(-1).method,'operation.acknowledge');
  next.reply('result',{id:original,status:'acknowledged'});await ack;
  assert.equal(next.bridge.pending,null);
});
test('other tabs and storage errors cannot dispatch writes; removed methods remain absent', async () => {
  const {bridge,sockets}=fixture();bridge.lock=async(_key,action)=>action(false);
  await assert.rejects(bridge.mutate('chat.send',{thread:'t',text:'x'}),/未确认/);
  assert.equal(sockets[0].sent.length,0);
  bridge.lock=async(_key,action)=>action(true);bridge.storage.setItem=()=>{throw new Error('storage unavailable');};
  await assert.rejects(bridge.mutate('chat.send',{thread:'t',text:'x'}),/storage/);
  assert.equal(sockets[0].sent.length,0);
  await assert.rejects(bridge.mutate('terminal.open',{}),/不支持/);
  await assert.rejects(bridge.mutate('files.read',{}),/不支持/);
});
test('newer draft and late receipts cannot erase new work',async()=>{
  const {bridge,reply}=fixture();const key=bridge.draftKey('t');bridge.storage.setItem(key,'first');
  const operation=bridge.mutate('chat.send',{thread:'t',text:'first'},{key,text:'first'});
  await tick();const id=bridge.pending.id;bridge.storage.setItem(key,'newer draft');
  reply('result',{id,status:'confirmed'});await operation;
  assert.equal(bridge.storage.getItem(key),'newer draft');
  assert.equal(bridge.receiptThread,'t');
  bridge.storage.setItem(bridge.pendingKey,JSON.stringify({id:'new-operation'}));
  await assert.rejects(bridge.applyReceipt({id,status:'confirmed'}),/不匹配/);
  assert.equal(bridge.pending.id,'new-operation');
});

test('context uses actual last-turn input',()=>{
 assert.equal(contextUsage({}),null);assert.deepEqual(contextUsage({latestTokenUsageInfo:{last:{inputTokens:2500},modelContextWindow:10000}}),{used:2500,limit:10000,percent:25});
});
test('all workspace writes are removed, while settings and compact use durable receipts',async()=>{
 const {bridge,sockets}=fixture();for(const method of ['git.stage','git.commit','side.create','side.send'])await assert.rejects(bridge.mutate(method,{}),/不支持/);assert.equal(sockets[0].sent.length,0);
});

test('out-of-order cached states cannot replace newer live states; reconnect resets Agent counters',()=>{
 const order=new StateSequence();
 assert.equal(order.accept({id:'a',sequence:12}),true);
 assert.equal(order.accept({id:'b',sequence:1}),true);
 assert.equal(order.accept({id:'a',sequence:11}),false);
 assert.equal(order.accept({id:'a',sequence:12}),true);
 order.reset();assert.equal(order.accept({id:'a',sequence:0}),true);
});

test('notification inbox receives unselected chats, deduplicates replay and persists separate computer inboxes',()=>{
 const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const a=new NotificationInbox(storage,'computer-a'),b=new NotificationInbox(storage,'computer-b');
 const event={id:'a'.repeat(64),kind:'approval',thread:'unselected',title:'Other conversation'};
 assert.equal(a.accept(event),true);assert.equal(a.accept(event),false);assert.equal(b.accept(event),true);
 assert.equal(new NotificationInbox(storage,'computer-a').accept(event),false);
 assert.equal(a.cursor,event.id);assert.equal(a.accept({...event,id:'b'.repeat(64),kind:'arbitrary'}),false);
});

test('two browser tabs refresh shared notification deduplication storage',()=>{
 const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const first=new NotificationInbox(storage,'same-computer'),second=new NotificationInbox(storage,'same-computer');
 const event={id:'c'.repeat(64),kind:'complete',thread:'a',title:'Done'};
 assert.equal(first.accept(event),true);assert.equal(second.accept(event),false);
});

test('notification storage failure does not drop the alert or repeat it within the page',()=>{
 const inbox=new NotificationInbox({getItem:()=>null,setItem:()=>{throw new Error('quota');}},'computer');
 const event={id:'d'.repeat(64),kind:'complete',thread:'a',title:'Done'};
 assert.equal(inbox.accept(event),true);assert.equal(inbox.accept(event),false);
});

test('settings preselect actual configuration and submit only edited fields in the open group',()=>{
 const base=sessionSettings({latestModel:'actual',latestReasoningEffort:'high',controlsRevision:'original',latestThreadSettings:{activePermissionProfile:{id:':danger-full-access'}},latestCollaborationMode:{mode:'plan'}});
 assert.deepEqual(base,{model:'actual',effort:'high',permission:'full',mode:'plan',revision:'original'});
 assert.deepEqual(changedSettings(base,{...base},'permission'),{});
 assert.deepEqual(changedSettings(base,{...base,model:'new',permission:'workspace',mode:'default'},'model'),{model:'new'});
 assert.deepEqual(changedSettings(base,{...base,permission:'read-only'},'permission'),{permission:'read-only'});
 assert.deepEqual(changedSettings(base,{...base,mode:'default'},'plan'),{mode:'default'});
 assert.deepEqual(changedSettings(base,{...base,effort:'default'},'model'),{effort:'default'});
 const custom=sessionSettings({latestThreadSettings:{activePermissionProfile:{id:'custom-profile'}}});
 assert.equal(custom.permission,'');assert.equal(custom.model,'');assert.equal(custom.effort,'default');
 assert.equal(sessionSettings({currentPermissions:{sandboxPolicy:{type:'workspace-write'}}}).permission,'workspace');
 assert.equal(sessionSettings({latestThreadSettings:{activePermissionProfile:{id:':workspace'},approvalsReviewer:'auto_review'}}).permission,'auto-review');
 assert.equal(sessionSettings({latestThreadSettings:{activePermissionProfile:{id:':workspace'},approvalsReviewer:'user'}}).permission,'workspace');
 assert.deepEqual(changedSettings({permission:'workspace'},{permission:'auto-review'},'permission'),{permission:'auto-review'});
});

test('official turn durations and live elapsed never invent missing timestamps', () => {
  assert.equal(turnElapsed({status:'completed',durationMs:764351}, 1), '用时 12 分 44 秒');
  assert.equal(turnElapsed({status:'interrupted',durationMs:0}, 1), '用时 0 秒');
  assert.equal(turnElapsed({status:'inProgress',turnStartedAtMs:1000}, 66000, true), '执行中 · 1:05');
  assert.equal(turnElapsed({status:'inProgress',turnStartedAtMs:1000}, 66000, false), '');
  assert.equal(turnElapsed({status:'completed'}, 66000, true), '');
  assert.equal(turnElapsed({status:'completed',durationMs:-2}, 66000), '');
  assert.equal(turnElapsed({turnStartedAtMs:1000}, 500, true), '');
  assert.equal(turnElapsed({}, 66000, true), '');
});

test('list timers require live official timing and never reuse a previous turn or activity date',()=>{
  const row={status:'running',live:true,statusSource:'desktop',updated:1,lastReplyAt:1,latestTurn:{status:'inProgress',turnStartedAtMs:1000}};
  assert.equal(sessionElapsed(row,66000,true),'运行中 · 1:05');
  assert.equal(sessionElapsed({...row,status:'waiting'},3666000,true),'待确认 · 1:01:05');
  for(const change of [{live:false},{status:'unknown'},{statusSource:'history'}])assert.equal(sessionElapsed({...row,...change},66000,true),'');
  assert.equal(sessionElapsed(row,66000,false),'');
  for(const turn of [null,{status:'completed',durationMs:5000},{status:'inProgress'},{status:'inProgress',turnStartedAtMs:67000}]){
    assert.equal(sessionElapsed({...row,latestTurn:turn},66000,true),'运行中 · 计时待同步');
  }
  assert.equal(sessionElapsed(row,NaN,true),'运行中 · 计时待同步');
  assert.equal(sessionElapsed({...row,status:'completed',latestTurn:{status:'completed',durationMs:764351}},66000,true),'用时 12 分 44 秒');
  assert.equal(sessionElapsed({...row,status:'interrupted',latestTurn:{status:'interrupted',durationMs:0}},66000,true),'用时 0 秒');
  assert.equal(sessionElapsed({...row,status:'completed'},66000,true),'');
  assert.equal(sessionElapsed({...row,status:'failed',latestTurn:{status:'failed',durationMs:-1}},66000,true),'');
});

test('read disconnect is not an uncertain write; stale socket events cannot close a replacement',async()=>{
 const {bridge,sockets}=fixture();
 const read=bridge.command('chat.history',{thread:'t'});
 const rejected=assert.rejects(read,error=>error.message==='连接中断，正在恢复连接。');
 const old=sockets[0];old.onclose();await rejected;
 bridge.connect({id:'device'});
 sockets[1].onmessage({data:JSON.stringify({type:'hello',data:{device:'device'}})});
 old.onclose();old.onmessage({data:JSON.stringify({type:'hello',data:{device:'wrong'}})});
 assert.equal(bridge.connected,true);
 assert.equal(sockets[1].sent.length,0);
 bridge.disconnect();
});

test('hello timeout releases a stalled connection, but never a healthy one',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {bridge,sockets}=fixture();
 bridge.connect({id:'device'});
 const stalled=sockets.at(-1);let closed=0;
 stalled.close=()=>{closed++;stalled.onclose();};
 t.mock.timers.tick(12000);
 assert.equal(closed,1);assert.equal(bridge.socket,null);
 bridge.connect({id:'device'});
 const healthy=sockets.at(-1);healthy.close=()=>{closed++;};
 healthy.onmessage({data:JSON.stringify({type:'hello',data:{device:'device'}})});
 t.mock.timers.tick(12000);
 assert.equal(closed,1);assert.equal(bridge.connected,true);
 bridge.disconnect();
});

test('notification resume checkpoints survive reconnect without erasing deduplication',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const first=new NotificationInbox(storage,'account'),second=new NotificationInbox(storage,'account');
 const event={id:'a'.repeat(64),kind:'complete',thread:'chat',title:'Done'};
 first.accept(event);first.checkpoint('baseline:current');
 assert.equal(first.cursor,'baseline:current');assert.equal(second.cursor,'baseline:current');
 assert.equal(new NotificationInbox(storage,'account').cursor,'baseline:current');
 assert.equal(new NotificationInbox(storage,'account').accept(event),false);
 first.checkpoint('b'.repeat(64));assert.equal(second.cursor,'b'.repeat(64));
 first.checkpoint('x'.repeat(129));assert.equal(first.cursor,'b'.repeat(64));
 first.checkpoint('');assert.equal(new NotificationInbox(storage,'account').cursor,'');
});

test('process projection preserves visible summaries, command/output and turn-qualified identity', () => {
  const messages = conversation([{turnId:'one',items:[
    {id:'tool',type:'commandExecution',command:'git status',aggregatedOutput:'full output',status:'inProgress'},
    {type:'reasoning',summary:['Visible',{text:'**summary**'}],encrypted_content:'SECRET',rawContent:['SECRET']},
    {type:'reasoning',encrypted_content:'SECRET'},
    {type:'agentMessage',text:'```sh\ngit status\n```'},
  ]},{turnId:'two',items:[{id:'tool',type:'commandExecution',command:'pwd',aggregatedOutput:''}]}]);
  assert.equal(messages.length,4);
  assert.equal(messages[0].command,'git status'); assert.equal(messages[0].text,'full output');
  assert.equal(messages[0].collapsible,true); assert.equal(messages[0].status,'inProgress');
  assert.equal(messages[1].text,'Visible\n**summary**'); assert.equal(messages[1].collapsible,true);
  assert.equal(messages[2].collapsible,false); assert.equal(messages[3].text,'pwd');
  assert.notEqual(messages[0].turn,messages[3].turn);
  assert(!JSON.stringify(messages).includes('SECRET'));
});

test('question navigator follows long replies and respects the loaded historical page', () => {
  const questions=Array.from({length:70},(_,i)=>({turn:'t'+i}));
  const rows=[{turn:'t35',top:-2000},{turn:'t36',top:-1000},{turn:'t37',top:500}];
  assert.equal(activeQuestionIndex(questions,rows,35,false,false),36);
  assert.equal(activeQuestionIndex(questions,rows,35,true,false),37);
  assert.equal(activeQuestionIndex(questions,rows,35,true,true),69);
  assert.equal(activeQuestionIndex(questions,[{turn:'t35',top:100}],35,false,false),35);
  assert.equal(activeQuestionIndex([],[],35,true,true),-1);
});
test('computer shortcuts accept HTTPS sites only and never pairing credentials', () => {
  assert.equal(computerAddress('https://desktop.example/cxpalm/'),'https://desktop.example');
  assert.equal(computerAddress(' https://desktop.example:8443/ '),'https://desktop.example:8443');
  for(const address of ['http://desktop.example','javascript:alert(1)','https://user:pass@desktop.example','https://desktop.example/?token=secret','https://desktop.example/#pair=secret','https://desktop.example/other'])assert.throws(()=>computerAddress(address));
});

test('continuous history preserves order, replaces overlaps and respects both boundaries', () => {
  const turn=n=>({turnId:`t${n}`,items:[]});
  const latest={offset:40,total:60,hasMore:false,turns:Array.from({length:20},(_,i)=>turn(i+40))};
  const older={offset:20,total:60,hasMore:true,turns:Array.from({length:20},(_,i)=>turn(i+20))};
  const window=extendHistory(latest,older);
  assert.equal(window.offset,20);assert.equal(window.hasMore,false);assert.equal(window.turns.length,40);
  assert.equal(window.turns[0].turnId,'t20');assert.equal(window.turns.at(-1).turnId,'t59');
  const repeated=extendHistory(window,{...older,offset:0,turns:Array.from({length:20},(_,i)=>turn(i))});
  assert.equal(repeated.offset,0);assert.equal(repeated.turns.length,60);assert.equal(repeated.hasMore,false);
  const update=mergeHistoryTurns(repeated.turns,[{...turn(59),status:'completed'},turn(60)]);
  assert.equal(update.length,61);assert.equal(update[59].status,'completed');
  assert.equal(extendHistory(older,latest).hasMore,false);
});

test('read idle and unknown chats are quiet while official unread and active work keep indicators', () => {
  for(const status of ['idle','completed','failed','interrupted','unknown']) {
    assert.equal(sessionIndicator(status,false),null);assert.equal(sessionIndicator(status,null),null);
  }
  assert.equal(sessionIndicator('unknown',true),'completed');
  assert.equal(sessionIndicator('completed',true),'completed');
  assert.equal(sessionIndicator('failed',true),'failed');
  assert.equal(sessionIndicator('interrupted',true),'interrupted');
  assert.equal(sessionIndicator('running',false),'running');
  assert.equal(sessionIndicator('waiting',false),'waiting');
  assert.equal(sessionIndicator('running',true,true),null);
  assert.equal(effortLabel('high'),'高');assert.equal(effortLabel('custom-effort'),'custom-effort');
});

test('tab reading cache isolates authorizations and never restores approval/read authority',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const cache=new ReadingCache(storage,'device:expiry');
  const snapshot={turns:[{turnId:'t',items:[{type:'agentMessage',text:'saved answer'}]}],requests:[{id:'approval'}],hasUnreadTurn:true,readToken:'secret',threadRuntimeStatus:{type:'active'},latestCollaborationMode:{mode:'plan'}};
  cache.remember('t',{snapshot,historyPage:{offset:0,turns:[]}});cache.save();
  const row=new ReadingCache(storage,'device:expiry').get('t');assert.equal(row.snapshot.turns[0].items[0].text,'saved answer');assert.equal(row.snapshot.latestCollaborationMode.mode,'plan');
  assert.equal(row.snapshot.requests,undefined);assert.equal(row.snapshot.hasUnreadTurn,undefined);assert.equal(row.snapshot.readToken,undefined);assert.equal(row.snapshot.threadRuntimeStatus.type,'unknown');
  assert.equal(snapshot.requests.length,1);assert.equal(new ReadingCache(storage,'other-device').get('t'),null);
  cache.clear();assert.equal(new ReadingCache(storage,'device:expiry').get('t'),null);
  for(let i=0;i<20;i++)cache.remember('t'+i,{snapshot});assert.equal(cache.rows.size,8);
});

test('lightweight history indexes reuse visible turns and preserve continuous reverse scrolling', async () => {
  const {seedHistoryIndex,extendHistory}=await import('./protocol-v1.mjs');
  const snapshot={turns:[{turnId:'t9'},{turnId:'t10'}]};
  const page={turns:[],questions:[],offset:9,total:11,hasMore:false};
  const index=seedHistoryIndex(page,snapshot,true);
  assert.equal(index.turns,snapshot.turns);
  assert.equal(page.turns.length,0);
  const earlier={turns:[{turnId:'t8'}],questions:[],offset:8,total:11,hasMore:true};
  assert.deepEqual(extendHistory(index,earlier).turns.map(turn=>turn.turnId),['t8','t9','t10']);
  assert.equal(seedHistoryIndex(earlier,snapshot,false),earlier);
});


test('Go stream contract reconstructs exact snapshots and shares untouched messages', async()=>{
  const {readFile}=await import('node:fs/promises');
  const frames=JSON.parse(await readFile(new URL('../internal/server/testdata/stream-contract.json',import.meta.url),'utf8'));
  const stream=new SnapshotStream();stream.reset('thread','fixture-stream');
  let first;
  for(const [index,frame] of frames.entries()){
    const event=stream.accept(frame.event);assert.deepEqual(event.data,frame.expected);
    if(index===0)first=event.data.snapshot.turns[0].items[0];
    if(index===1)assert.equal(first,event.data.snapshot.turns[0].items[0]);
  }
  assert.equal(stream.accept({type:'chat.delta',data:{id:'thread',streamID:'old-stream',base:5,streamRevision:6,ops:[]}}),null);
  assert.throws(()=>stream.accept({type:'chat.delta',data:{id:'thread',streamID:'fixture-stream',base:99,streamRevision:100,ops:[]}}),/gap/);
  assert.equal(stream.accept(frames[1].event),null,'no further deltas accepted after a gap');
  stream.reset('thread','fixture-stream');assert.deepEqual(stream.accept(frames[0].event).data,frames[0].expected);
});
test('stream gap recovers by read-only subscription without replaying a pending write',async()=>{
  const {bridge,sockets,reply}=fixture();
  const subscription=bridge.command('chat.subscribe',{thread:'thread',stream:true});reply('result',{subscribed:true});await subscription;
  const id=sockets[0].sent.at(-1).id;
  sockets[0].onmessage({data:JSON.stringify({type:'chat.state',data:{id:'thread',streamID:id,streamRevision:1,sequence:1,snapshot:{turns:[]}}})});
  const operation=bridge.mutate('chat.send',{thread:'thread',text:'hello'});await tick();
  const write=sockets[0].sent.at(-1);
  sockets[0].onmessage({data:JSON.stringify({type:'chat.delta',data:{id:'thread',streamID:id,base:7,streamRevision:8,ops:[]}})});
  const recovery=sockets[0].sent.at(-1);assert.equal(recovery.method,'chat.subscribe');assert.equal(recovery.thread,'thread');
  assert.equal(sockets[0].sent.filter(q=>q.method==='chat.send').length,1);
  sockets[0].onmessage({data:JSON.stringify({type:'result',id:write.id,data:{id:write.id,status:'confirmed'}})});await operation;
  reply('result',{subscribed:true});bridge.disconnect();
});
test('deferred process rows remain visible and immutable offline cache reuses body objects',()=>{
  const item={id:'tool',type:'commandExecution',text:'',command:'echo fixture',deferred:true,bodyRevision:'v1'};
  const turns=[{turnId:'t',items:[item]}];const messages=conversation(turns);assert.equal(messages.length,1);assert.equal(messages[0].deferred,true);assert.equal(conversation(turns)[0],messages[0]);
  const snapshot={turns,requests:[{id:'approval'}],hasUnreadTurn:true,threadRuntimeStatus:{type:'active'}};
  const offline=offlineReading(snapshot);assert.equal(offline.turns,turns);assert.equal(snapshot.hasUnreadTurn,true);assert.equal(offline.hasUnreadTurn,undefined);
});

test('native imageGeneration items are assistant image-only messages',()=>{const rows=conversation([{turnId:'turn',items:[{id:'generated',type:'imageGeneration',images:[{id:'f'.repeat(64),name:'generated.png'}]}]}]);assert.equal(rows.length,1);assert.equal(rows[0].role,'Codex');assert.equal(rows[0].collapsible,false);assert.equal(rows[0].images.length,1);});

test('silent open socket expires without replaying writes and old callbacks cannot revive it',async()=>{
 const {bridge,sockets}=fixture();const socket=sockets[0];let lost=0;bridge.event=e=>{if(e.type==='disconnected')lost++};
 const operation=bridge.mutate('chat.send',{thread:'thread',text:'once'});await tick();const pending=bridge.pending.id;
 socket.onmessage({data:JSON.stringify({type:'connection.heartbeat'})});const last=bridge.lastMessageAt;
 bridge.checkConnection(last+29999);assert.equal(bridge.connected,true);
 bridge.checkConnection(last+30000);await assert.rejects(operation,/中断/);
 assert.equal(bridge.connected,false);assert.equal(bridge.pending.id,pending);assert.equal(lost,1);
 socket.onclose();socket.onmessage({data:JSON.stringify({type:'hello',data:{device:'device'}})});
 assert.equal(lost,1);assert.equal(bridge.connected,false);assert.equal(socket.sent.filter(q=>q.method==='chat.send').length,1);
 bridge.disconnect();
});
