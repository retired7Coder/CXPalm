import {markdown} from './markdown-v1.mjs';
import {seedHistoryIndex, Bridge, conversation, approvalDecisions, contextUsage, NotificationInbox, StateSequence, mergeSessionReadState, sessionSettings, changedSettings, newChatDefaults, turnElapsed, sessionElapsed, activeQuestionIndex, computerAddress, mergeHistoryTurns, extendHistory, sessionIndicator, effortLabel, ReadingCache, MediaCache, connectionPresentation, operationLabel, AttachmentUploads, activeTurnId} from './protocol-v1.mjs';

const $ = id => document.getElementById(id);
const state = {page:'chat',device:null,version:'',sessions:[],projects:[],archived:false,project:'',listLimit:100,listSubscription:null,hasMore:false,settingsBase:null,editGroup:null,selected:null,snapshot:null,desktop:false,reconnect:null,openTools:new Set(),catalog:{models:[],skills:[]},skills:new Set()};
let connectAttempt = 0;
let inbox;
let readAttempt;
let readSyncSupported=false;
let readToken;
let catalogRequest;
let soundContext;
let selection = 0;
const sequences = new StateSequence();
const messageNodes = new Map();
const timingNodes = new Map();
let approvalSignature;
let historyRequest = 0;
let readingCache;
let cacheTimer;
state.cached=false;
let pinnedToLatest = true;
let historyScrollArmed = false;
let historyScrollTop = 0;
let historyAutoRetryAt = 0;
let sentUserBefore = null;
let questionTarget = null;
let questionScrubbing = false;
let goalDraft = false;
let composing = false;
const uploads = new AttachmentUploads({storage:sessionStorage,changed:()=>renderControls()});
const mediaCache = new MediaCache();
function attachmentKey() { return state.selected && bridge.device ? `cxpalm:attachments:${bridge.device.id}:${state.selected.id}` : null; }
function attachedFiles() { try { return JSON.parse(localStorage.getItem(attachmentKey()) || '[]'); } catch { return []; } }
function renderAttachments() {
  const key=attachmentKey(), busy=uploads.busy(key);
  const files=attachedFiles();
  $('attachment-list').replaceChildren(...files.map(file=>{
    const row=text('span','','attachment-chip');
    row.append(text('span',`${file.image?'▧':'↥'} ${file.name} · ${(file.size/1024).toFixed(0)} KB`));
    const remove=text('button','×','quiet');remove.type='button';remove.setAttribute('aria-label',`移除附件 ${file.name}`);remove.disabled=!!currentPending();
    remove.onclick=()=>{localStorage.setItem(key,JSON.stringify(attachedFiles().filter(item=>item.id!==file.id)));renderControls();};row.append(remove);return row;
  }));
  const jobs=uploads.list(key);
  const uploadSignature=JSON.stringify([key,jobs.map(({id,name,status,error})=>({id,name,status,error}))]);
  if($('upload-list').dataset.signature!==uploadSignature){$('upload-list').dataset.signature=uploadSignature;$('upload-list').replaceChildren(...jobs.map(job=>{
    const row=text('div','','upload-row');row.dataset.upload=job.id;
    const content=text('div','','upload-copy');content.append(text('strong',job.name),text('span',({queued:'等待上传',uploading:'正在上传…',failed:'上传未完成',cancelled:'上传已取消',interrupted:'上传结果待核对'})[job.status]||'上传状态未知'));
    if(job.error)content.append(text('small',job.error));
    row.append(content);
    const active=['queued','uploading'].includes(job.status);
    if(job.status==='uploading'){const progress=document.createElement('progress');progress.setAttribute('aria-label',`正在上传 ${job.name}`);row.append(progress);}
    const action=text('button',active?'取消上传':'关闭提示','quiet');action.type='button';action.setAttribute('aria-label',`${active?'取消上传':'关闭提示'} ${job.name}`);action.onclick=()=>active?uploads.cancel(job.id):uploads.dismiss(job.id);row.append(action);return row;
  }));}
  $('upload-list').hidden=!jobs.length;
  $('attachment-status').hidden=!files.length;
  $('attachment-status').textContent=files.length?`${files.length}/8 · 附件将在电脑本地保存`:'';
  $('attach-file').disabled=!bridge.connected||!state.desktop||!state.selected||state.cached||!!currentPending()||busy||goalDraft||files.length>=8;
  return busy;
}
async function uploadFiles(input) {
  const key=attachmentKey(),thread=state.selected?.id,device=state.device,files=Array.from(input);
  if(!key||$('attach-file').disabled||!files.length)return;
  if(files.length+attachedFiles().length>8)throw new Error('每条消息最多 8 个附件。');
  if(files.some(file=>file.size===0||file.size>20*1024*1024))throw new Error('每个附件须为 1 字节至 20 MiB。');
  await uploads.upload(key,files,{thread,valid:()=>state.device===device&&bridge.device===device&&bridge.connected,
    saved:uploaded=>{const saved=JSON.parse(localStorage.getItem(key)||'[]');saved.push(uploaded);localStorage.setItem(key,JSON.stringify(saved));}});
}
let timingAnchor = {server:Date.now(), local:performance.now()};
let listTimingAnchor = null;
let questionSignature = "";
state.history = null;
state.historyPage = null;
state.historyLoading = false;
state.historyAttempt = null;

function text(tag, value, className = '') {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function report(error) {
  if(error?.operation) { renderPending(); return; }
  $('notice-text').textContent = error instanceof Error ? error.message : String(error);
  $('notice').hidden = false;
  const panel=document.querySelector('.inline-panel:not([hidden])');
  if(panel){let message=panel.querySelector('.panel-error');if(!message){message=text('p','','panel-error');message.setAttribute('role','alert');panel.querySelector('.panel-heading').after(message);}message.textContent=$('notice-text').textContent;}
}
function run(action) { return Promise.resolve().then(action).catch(report); }
async function imageBitmap(thread,message,image,scope,valid) {
  const blob=await mediaCache.read(scope,'image',{thread,turn:message.turn,item:message.id,image:image.id},valid);
  return createImageBitmap(blob);
}
function appendImages(body,message) {
  const thread=state.selected?.id,authorization=bridge.device;
  const scope=JSON.stringify([authorization?.id,authorization?.expires]);
  for(const image of message.images||[]) {
    if(!/^[a-f0-9]{64}$/.test(image.id))continue;
    const button=text('button','正在读取图片…','conversation-image');button.type='button';body.append(button);
    const valid=()=>!!authorization&&bridge.device===authorization&&state.selected?.id===thread&&button.isConnected;
    const load=async()=>{
      button.disabled=true;
      try {
        const bitmap=await imageBitmap(thread,message,image,scope,valid);
        try {if(!button.isConnected||!valid())return;
          const canvas=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',image.name||'会话图片');
          button.replaceChildren(canvas,text('span','点击查看图片'));button.onclick=()=>run(async()=>{
            const original=await imageBitmap(thread,message,image,scope,valid);
            try {if(!valid())return;
              const dialog=document.createElement('dialog');dialog.className='image-viewer';
              const close=text('button','关闭图片','quiet');close.type='button';close.onclick=()=>dialog.close();
              const full=document.createElement('canvas');full.width=original.width;full.height=original.height;full.getContext('2d').drawImage(original,0,0);full.setAttribute('role','img');full.setAttribute('aria-label',image.name||'会话图片');
              const container=text('div','','image-original');container.append(full);
              const size=text('button','原尺寸','quiet');size.type='button';size.onclick=()=>{const actual=container.classList.toggle('actual');size.textContent=actual?'适应窗口':'原尺寸';};
              dialog.append(close,size,container);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
            }finally{original.close();}
          });
        }finally{bitmap.close();}
      }catch(error){button.textContent='图片读取失败 · 点击重试';button.onclick=()=>run(load);button.title=error.message;}
      finally{button.disabled=false;}
    };
    requestAnimationFrame(()=>run(load));
  }
}
function appendFiles(body,message) {
  const thread=state.selected?.id,authorization=bridge.device;
  for(const file of message.files||[]) {
    if(!/^[a-f0-9]{64}$/.test(file.id)||typeof file.name!=='string')continue;
    const card=text('div','','returned-file');
    const info=text('div','','returned-file-copy');
    info.append(text('strong',file.name),text('small',`${String(file.kind||'文件').toUpperCase()} · 由电脑提供`));
    const button=text('button','下载','quiet file-download');button.type='button';button.setAttribute('aria-label',`下载 ${file.name}`);
    const status=text('small','','returned-file-status');status.setAttribute('role','status');
    button.onclick=async()=>{
      const valid=()=>!!authorization&&bridge.device===authorization&&state.selected?.id===thread&&bridge.connected&&!state.cached&&button.isConnected;
      button.disabled=true;status.textContent='正在下载…';
      try {
        if(!valid())throw new Error('请连接原电脑并打开此会话后下载。');
        const blob=await mediaCache.read(JSON.stringify([authorization?.id,authorization?.expires]),'file',{thread,turn:message.turn,item:message.id,file:file.id},valid);
        if(!valid()||!button.isConnected)return;
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a');link.href=url;link.download=file.name;link.hidden=true;document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
        status.textContent='已交给浏览器保存，请在下载列表中查看。';
      }catch(error){if(button.isConnected)status.textContent=error.message;}
      finally{button.disabled=false;}
    };
    card.append(info,button,status);body.append(card);
  }
}
function listen(id, event, action) { $(id).addEventListener(event, e => { e.preventDefault(); run(() => action(e)); }); }
listen('clear-media-cache','click',async()=>{
  $('clear-media-cache').disabled=true;
  try {await mediaCache.clear();$('media-cache-status').textContent='缓存已清除，下次查看将重新下载。';}
  finally{$('clear-media-cache').disabled=false;}
});
function reminderSync(error='') {
  const previous=state.reminderError;
  state.reminderError=error;state.reminderReady=true;
  if(error)report(error);
  else if(previous && $('notice-text').textContent===previous)$('notice').hidden=true;
  $('notification-sync-status').textContent=error||'提醒连接正常 · 会话状态持续同步';
}
async function api(path, body = {}) {
  const response = await fetch(`/api/v1/browser/${path}`, {method: 'POST', credentials: 'same-origin', cache: 'no-store',
    redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!response.ok) {
    const error = new Error(response.status === 401 ? (path==='login'?'账号或密码错误，或电脑尚未设置登录账号。':'登录已过期或已退出，请重新登录。') :
      response.status === 429 ? '登录尝试过多，请稍后再试。' :
      path==='login'?`登录暂不可用（HTTP ${response.status}），请检查电脑端网关后重试。` : `连接失败（HTTP ${response.status}）。请检查电脑端网关后重试。`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
const bridge = new Bridge({
  storage: localStorage,
  lock: (name, action, wait = false) => {
    if (!navigator.locks) throw new Error('此浏览器不支持跨标签页写操作锁。请更新浏览器；目前可只读查看。');
    return navigator.locks.request(name, {ifAvailable: !wait}, lock => action(!!lock));
  },
  socket: () => new WebSocket(`wss://${location.host}/api/v1/ws`),
  changed: () => { syncClearedDraft(); renderControls(); renderPending(); renderLists(); },
  event: event => run(async () => {
    if (event.type === 'hello') {
      state.steerTurnSupported=event.data.capabilities?.includes('chat.steer.turn')===true;
      state.connecting=null;
      state.createSettingsSupported=event.data.capabilities?.includes('sessions.create.settings')===true;
      state.reminderReady=false;
      clearTimeout(state.reconnect);
      const recoveredErrors=new Set(['连接中断，正在恢复连接。',state.connectionError]);
      if(recoveredErrors.has($('notice-text').textContent))$('notice').hidden=true;
      for(const message of document.querySelectorAll('.panel-error'))if(recoveredErrors.has(message.textContent))message.remove();
      state.connectionError=null;
      sequences.reset();
      state.readState=null;
      readToken=null;
      readAttempt=null;readSyncSupported=event.data.capabilities?.includes('chat.read')===true;
      inbox=new NotificationInbox(localStorage,`cxpalm:notifications:${bridge.device.id}`);
      // Restore the selected chat without waiting for notification/list round trips.
      let previous=state.selected;
      if(!previous){try{previous=JSON.parse(localStorage.getItem(`cxpalm:selected:${bridge.device.id}`)||'null');}catch{}}
      if(previous?.id)run(()=>selectChat(previous,false,true));
      run(refreshLists);
      for(const pending of bridge.pendings)run(()=>bridge.checkPending(pending.id));
      if(!event.data.capabilities?.includes('notifications.subscribe'))report('当前网关不支持跨会话提醒，请更新网关。');
      else run(async()=>{
        const replay=await bridge.command('notifications.subscribe',{cursor:inbox.cursor});
        for(const event of replay.events||[])await receiveNotification(event);
        inbox.checkpoint(replay.cursor??(replay.gap?'':undefined));
        if(replay.resynced||replay.gap)await refreshLists();
        reminderSync(replay.error||'');
      });
    } else if(event.type === 'sessions.error'&&event.data.subscription===state.listSubscription) {
      state.sessions=state.sessions.map(row=>({...row,live:false,status:'unknown',unread:null}));renderLists();report(event.data.error);
    } else if(event.type === 'sessions.page') {
      if(event.data.subscription===state.listSubscription)applySessionPage(event.data.page);
    } else if (event.type === 'chat.state' && event.data.id === state.selected?.id) {
      if (!sequences.accept(event.data)) return;
      state.desktop = event.data.connected;
      if(Number.isSafeInteger(event.data.nativeSyncedAtMs)&&event.data.nativeSyncedAtMs>0)state.nativeSyncedAtMs=event.data.nativeSyncedAtMs;
      if(typeof event.data.archived==='boolean')state.selected.archived=event.data.archived;
      if (event.data.snapshot) { if(event.data.snapshot.hasUnreadTurn===false)readAttempt=null;state.snapshot = event.data.snapshot;state.cached=!event.data.connected&&!event.data.archived;rememberReading(true); timingAnchor={server:Number.isFinite(state.snapshot.observedAtMs)?state.snapshot.observedAtMs:Date.now(),local:performance.now()}; readToken=event.data.readToken||null; }
      if(event.data.connected&&event.data.snapshot){
        const update={id:event.data.id,live:true,sequence:event.data.sequence,unread:state.snapshot.hasUnreadTurn,readToken};
        state.readState=mergeSessionReadState(state.readState||{id:update.id},update);
        let changed=false;
        state.sessions=state.sessions.map(row=>{const next=mergeSessionReadState(row,state.readState);if(next.unread!==row.unread)changed=true;return next;});
        if(state.readState.readToken===readToken&&state.readState.sequence>update.sequence)state.snapshot={...state.snapshot,hasUnreadTurn:state.readState.unread};
        if(changed)renderLists();
      }
      if(event.data.connected)rememberNewChat();
      renderConversation();
      renderControls();
      if (event.data.error) {state.desktopError=event.data.error;report(event.data.error);}
      else if(event.data.connected&&state.desktopError){
        if($('notice-text').textContent===state.desktopError)$('notice').hidden=true;
        for(const message of document.querySelectorAll('.panel-error'))if(message.textContent===state.desktopError)message.remove();
        state.desktopError=null;
      }
      refreshQuestionIndex();
    } else if (event.type === 'notification') {
      receiveNotification(event.data);
    } else if (event.type === 'notifications.status') {
      reminderSync(event.data.error||'');
    } else if (event.type === 'disconnected') {
      state.readState=null;
      uploads.cancelAll();state.connecting=null;
      rememberReading();state.sessions=state.sessions.map(row=>({...row,live:false,status:'unknown',unread:null}));renderLists();state.cached=!!state.snapshot;state.desktop = false;state.historyLoading=false;readToken=null;readSyncSupported=false;++historyRequest;
      renderControls();
      if (state.device) state.reconnect = setTimeout(() => run(() => connect(false)), 3000);
    }
  }),
});

function drawer(open) {
  const mobile = matchMedia('(max-width:760px)').matches;
  open = open && mobile;
  $('shell').classList.toggle('list-open', open);
  $('show-list').setAttribute('aria-expanded', String(open));
  $('close-list').hidden = !open;
  document.querySelector('.console').inert = open;
  $('sidebar').setAttribute('role', open ? 'dialog' : 'complementary');
  if (open) { $('sidebar').setAttribute('aria-modal', 'true'); $('close-list').focus(); }
  else { $('sidebar').removeAttribute('aria-modal'); markVisibleRead(); }
}
function showPage(page) {
  if(state.page==='chat'&&page!=='chat'){state.savedChatTop=$('messages').scrollTop;state.savedChatBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<=2;}
  state.page = page;
  for (const name of ['chat', 'settings']) {
    $(`${name}-view`).hidden = name !== page;
    $(`nav-${name}`).classList.toggle('selected', name === page);
    $(`nav-${name}`).setAttribute('aria-current', name === page ? 'page' : 'false');
  }
  if(page==='chat'&&state.savedChatTop!==undefined){$('messages').scrollTop=state.savedChatBottom&&!state.historyPage?$('messages').scrollHeight:state.savedChatTop;}
  drawer(false);
  renderHeading();renderPending();
}
function renderHeading() {
  $('view-title').textContent = state.page === 'settings' ? '设置' : state.selected?.title || '选择一个会话';
  $('view-subtitle').textContent = state.page === 'settings' ? location.origin : '会话由官方桌面执行';
  $('context-button').hidden=state.page!=='chat';
  $('rename-chat').hidden=state.page!=='chat'||!state.selected;
  if(state.page!=='chat'||!state.selected)$('rename-panel').hidden=true;
}
function permissionName(settings) {
  const value=sessionSettings({latestThreadSettings:settings}).permission;
  return ({'read-only':'只读','workspace':'手动批准','auto-review':'帮我批准','full':'完全访问'})[value]||'自定义权限';
}
function renderQueue(writable) {
  const container=$('message-queue'), rows=state.snapshot?.queuedMessages||[];
  container.hidden=!rows.length;container.replaceChildren();
  if(!rows.length)return;
  const heading=text('summary',`排队消息 · ${rows.length}`);
  const details=document.createElement('details');details.open=true;details.append(heading);
  for(const [index,item] of rows.entries()){
    const row=text('div','','queue-item');
    const label=({queued:'等待发送',sending:'正在交给桌面',sent:'已发送 · 等待桌面同步',unknown:'结果待核对 · 队列暂停'})[item.status]||'等待同步';
    const content=text('div','','queue-content');content.append(text('small',`${index+1} · ${label}`),text('p',item.text));
    if(item.error)content.append(text('small',item.error,'queue-error'));
    row.append(content);
    if(['queued','unknown','sent'].includes(item.status)){
      const cancel=text('button',item.status!=='queued'?'核对后移除':'×','quiet');cancel.type='button';cancel.title=cancel.ariaLabel=item.status!=='queued'?'核对桌面后移除，不会撤回已发送的消息':'取消排队消息';cancel.disabled=!writable;
      const thread=state.selected?.id;
      cancel.addEventListener('click',()=>run(async()=>{if(item.status!=='queued'&&!confirm('请先在官方桌面核对这条消息。移除后继续后面的队列，不会撤回已发送的消息，也不会重发本条。'))return;await write('chat.queue.cancel',{thread,requestId:item.id});}));row.append(cancel);
    }
    details.append(row);
  }
  container.append(details);
}
function renderControls() {
  const uploading=renderAttachments(),files=attachedFiles();
  const pending=bridge.device && currentPending();
  const active=state.snapshot?.threadRuntimeStatus?.type==='active';
  const available=bridge.connected && !!state.selected && state.desktop;
  const writable=available && !state.cached && !!state.snapshot && !state.selected?.archived && !pending && !!navigator.locks;
  if(!bridge.connected)$('notification-sync-status').textContent=state.device?'提醒连接已断开，恢复后自动同步':'提醒尚未连接';
  else if(!state.reminderReady)$('notification-sync-status').textContent='正在恢复提醒连接…';
  $('new-chat').disabled=!bridge.connected;
  $('rename-chat').disabled=!bridge.connected||!!pending;
  $('save-rename').disabled=!bridge.connected||!!pending;
  $('create-chat').disabled=!bridge.connected||!!bridge.pendingFor(null)||!$('new-project').value;
  const mode=$('send-mode').value;
  $('send-mode-help').textContent=({auto:'智能发送：空闲时开始新一轮；执行中引导当前任务，不中断、不另开会话。',steer:'仅引导任务：只在任务执行中补充要求，不另开一轮。',queue:'排队发送：当前任务结束后按顺序发送；关闭页面也不会丢失。结果未知时暂停，不会自动重发。'})[mode];
  const health=connectionPresentation({device:state.device,connecting:state.connecting,connected:bridge.connected,selected:state.selected,desktop:state.desktop,cached:state.cached,writable,pending,nativeSyncedAtMs:state.nativeSyncedAtMs});
  const syncLabel=health.nativeSyncedAtMs?`最近原生同步：${new Date(health.nativeSyncedAtMs).toLocaleString()}`:'尚未收到同步时间';
  for(const [id,value] of [['connection',health.label],['connection-health-label',health.label],['connection-sync',syncLabel]])if($(id).textContent!==value)$(id).textContent=value;
  $('connection').title=health.label;$('connection-health').dataset.stage=health.kind;
  const readUnavailable=available&&!state.cached&&!state.selected.archived&&state.snapshot?.hasUnreadTurn===true&&state.snapshot?.readSyncAvailable===false;
  $('read-sync-status').hidden=!readUnavailable;
  $('read-sync-status').textContent=readUnavailable?'已读尚未同步，蓝色仍表示官方桌面未读。请在电脑的官方 Codex 中打开当前会话，再回到网页查看最新回复。':'';
  $('connection').classList.toggle('online',bridge.connected);
  $('reconnect').hidden=!state.device||bridge.connected;
  $('message').disabled=!state.selected;
  $('message').placeholder=state.selected?'继续这个官方桌面会话…':'选择会话后继续对话…';
  const queuing=mode==='queue'&&(active||state.snapshot?.queuedMessages?.length>0);
  const steering=mode==='steer'||(mode==='auto'&&active);
  $('send').disabled=!writable||uploading||(!$('message').value.trim()&&!files.length)||(goalDraft&&files.length>0)||(queuing&&!state.snapshot?.queueAvailable)||(mode==='steer'&&!active);
  $('send').textContent=queuing?'加入队列 ≡':goalDraft?'开启目标 ↗':steering?'引导 ↗':'发送 ↗';
  const sendAction=uploading?'正在上传附件，完成或取消后才能发送。':pending?'请先核对原操作，不会自动重发。':queuing?'加入电脑队列，前面的任务完成后发送。':goalDraft?'设置原生目标，由原桌面持续执行。':steering?'补充当前任务，不会另开一轮。':'开始新一轮对话。';
  if($('send-action').textContent!==sendAction)$('send-action').textContent=sendAction;
  renderQueue(writable);
  $('queue-send').hidden=!active||mode==='queue';$('queue-send').disabled=!writable||uploading||!state.snapshot?.queueAvailable||(!$('message').value.trim()&&!files.length)||goalDraft;
  const notifyUnavailable=state.snapshot?.notificationPreference?.available===false;
  $('notify-chat').disabled=!bridge.connected||!state.selected||!!pending||state.cached||notifyUnavailable;
  const notify=state.snapshot?.notificationPreference?.enabled===true;
  $('notify-chat').textContent=notifyUnavailable?'通知：暂不可用':notify?'通知：开':'通知：关';$('notify-chat').setAttribute('aria-pressed',String(notify));
  $('notify-chat').title=notifyUnavailable?state.snapshot.notificationPreference.reason||'桌面身份暂不可用，正常聊天不受影响':'';
  $('stop').disabled=!writable||!active;
  $('apply-settings').disabled=!writable||!state.settingsBase||!Object.keys(settingsChanges()).length;
  $('compact').disabled=!writable||active;

  $('chat-status').textContent=pending?'操作等待确认，不会自动重发':!state.selected?'选择一个会话，继续电脑上的工作':!bridge.connected?(state.snapshot?'离线缓存 · 等待同步':'等待重新连接 · 草稿已保留'):state.selected.archived?'已归档 · 请在官方桌面取消归档后继续对话':!state.desktop?'正在同步官方桌面 · 历史暂为只读':active?'正在工作 · 你可以引导或停止任务':$('send-key').value==='enter'?'Enter 发送 · Shift + Enter 换行':'Ctrl / ⌘ + Enter 发送';
  for(const button of $('approvals').querySelectorAll('button'))button.disabled=!writable;
  const current=state.snapshot;
  for(const id of ['model-button','permission-button','plan-button','context-button'])$(id).disabled=!current||(state.cached&&id!=='context-button');
  $('skill-button').disabled=!state.selected||!state.desktop;
  $('model-label').textContent=current?`${current.latestModel||'模型未读取'}${current.latestReasoningEffort?' · '+effortLabel(current.latestReasoningEffort):''}`:'模型未读取';
  $('full-access-confirm').hidden=settingsChanges().permission!=='full';
  const permission=permissionName(current?.latestThreadSettings||current?.currentPermissions);
  $('permission-label').textContent=current?permission:'权限';
  $('permission-button').classList.toggle('danger',!!current&&permission==='完全访问');
  const plan=current?.latestCollaborationMode?.mode==='plan';
  const goal=goalDraft||current?.threadGoal?.status==='active';
  $('plan-label').textContent=goal?'目标模式':plan?'计划模式':'默认模式';$('plan-button').title=goal?'目标模式':plan?'计划模式':'默认 / 计划 / 目标';$('plan-button').setAttribute('aria-label',$('plan-button').title);$('plan-button').setAttribute('aria-pressed',String(plan||goal));
  $('plan-button').classList.toggle('active',plan||goal);
  const nativeGoal=current?.threadGoal;
  $('goal-status').hidden=!nativeGoal;
  $('goal-objective').textContent=nativeGoal?`${({active:'目标进行中',paused:'目标已暂停',complete:'目标已完成',blocked:'目标等待处理',budget_limited:'目标预算已用尽',usage_limited:'目标用量受限'})[nativeGoal.status]||nativeGoal.status} · ${nativeGoal.objective}`:'';
  $('goal-pause').hidden=nativeGoal?.status!=='active';$('goal-resume').hidden=nativeGoal?.status!=='paused';
  for(const id of ['goal-pause','goal-resume','goal-clear'])$(id).disabled=!writable;
  const usage=contextUsage(current);
  const contextButton=$('context-button');
  contextButton.style.setProperty('--usage',`${usage?.percent??0}%`);
  contextButton.classList.toggle('unknown',!usage);
  contextButton.classList.toggle('high-usage',!!usage&&usage.percent>=85);
  contextButton.title=contextButton.ariaLabel=usage?`上下文已使用 ${usage.percent}%`:'上下文用量尚未提供';
  $('context-percent').textContent=usage?`${usage.percent}%`:'—';
  $('context-usage').textContent=usage?`${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens · ${usage.percent}%`:'官方桌面尚未提供本会话的上下文用量';
  if(current){
    const mode=current.latestCollaborationMode?.mode==='plan'?'计划模式':'默认模式';
    $('settings-current').textContent=`当前配置：${current.latestModel||'模型未读取'} · ${current.latestReasoningEffort||'模型默认'}\n${mode} · ${permission}${current.currentPermissions?'\n当前执行权限：'+permissionName(current.currentPermissions):''}`;
  }else $('settings-current').textContent='选择会话后读取当前配置。';
  $('message').placeholder=state.selected?'继续这个官方桌面会话…':'选择会话后继续对话…';
}
function currentPending() { return bridge.device && state.selected && bridge.pendingFor(state.selected.id); }
function displayedPending() { return bridge.device && (state.page==='chat' && state.selected ? bridge.noticeFor(state.selected.id) : null); }
function renderPending() {
  for(const [prefix,pending] of [['pending',displayedPending()],['create-pending',bridge.device && bridge.noticeFor(null)]]) {
    $(prefix).hidden = !pending;
    $(prefix).dataset.operation=pending?.id||'';
    if (!pending) continue;
    const receipt = bridge.receiptFor(pending);
    const terminal=['rejected','not_sent'].includes(receipt?.status);
    $(prefix+'-title').textContent = receipt?.status==='rejected'?'操作未执行':receipt?.status==='not_sent'?'操作未发送，草稿已保留':receipt?.status === 'unknown' ? '操作结果未知，不会自动重发' : '操作等待确认';
    const thread=state.sessions.find(row=>row.id===pending.thread)?.title||(state.selected?.id===pending.thread?state.selected.title:null)||'所属会话待核对';
    $(prefix+'-summary').textContent=`${operationLabel(pending.method)} · ${pending.thread?thread:'新会话'}${Number.isFinite(pending.created)?' · '+new Date(pending.created).toLocaleString():''}`;
    $(prefix+'-detail').textContent = receipt?.result?.error || '请查询这次操作的原始回执；超时或重连不代表操作失败。';
    $(prefix+'-technical').textContent=`${pending.method} · ${pending.id}`;
    $('check-'+prefix).hidden=terminal;
    $('dismiss-'+prefix).hidden=!terminal;
    $('check-'+prefix).disabled = !bridge.connected;
    $('ack-'+prefix).hidden = receipt?.status !== 'unknown';
    $('ack-'+prefix).disabled = !bridge.connected;
  }
}

function draftKey() { return state.selected && bridge.draftKey(state.selected.id); }
function syncClearedDraft() {
  const key = draftKey();
  if (key && bridge.receiptThread===state.selected?.id && bridge.receipt?.status === 'confirmed' && bridge.storage.getItem(key) === null) $('message').value = '';
}
function markVisibleRead() {
  const container=$('messages');
  if(state.cached || (state.historyPage?.hasMore) || !readSyncSupported || state.snapshot?.readSyncAvailable===false || !bridge.connected || !state.desktop || !state.selected || !state.snapshot || state.page!=='chat' || document.visibilityState!=='visible' || $('shell').classList.contains('list-open'))return;
  const latest=[...container.querySelectorAll('.message[data-role="Codex"]')].at(-1);
  if(!latest)return;
  const viewport=container.getBoundingClientRect(),reply=latest.getBoundingClientRect();
  if(reply.bottom>viewport.bottom+8||reply.top>viewport.bottom)return;
  if(state.snapshot.hasUnreadTurn!==true || !/^[a-f0-9]{64}$/.test(readToken||''))return;
  const key=`${selection}:${state.selected.id}:${readToken}`;
  if(readAttempt===key)return;
  readAttempt=key;
  // The server owns the read state. Do not optimistically hide unread on this device.
  run(()=>bridge.command('chat.read',{thread:state.selected.id,readToken}).then(result=>{
    if(readAttempt!==key)return;
    if(result.available===false){state.snapshot={...state.snapshot,readSyncAvailable:false};renderControls();}
    if(result.accepted!==true)readAttempt=null;
  }).catch(error=>{if(readAttempt===key)readAttempt=null;throw error;}));
}
document.addEventListener('visibilitychange',()=>run(()=>markVisibleRead()));
$('messages').addEventListener('scroll',()=>run(()=>markVisibleRead()),{passive:true});
// Only a user's scroll intent changes resize-following; layout scroll events do not.
for(const event of ['wheel','touchmove','pointerup','keyup'])$('messages').addEventListener(event,()=>requestAnimationFrame(()=>{pinnedToLatest=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<=2;}),{passive:true});
const sessionLabels={running:'进行中',completed:'已完成',failed:'失败',interrupted:'已中断',waiting:'待确认',idle:'空闲',unknown:'状态未知'};
const projectCollapse = new Map();
function collapsedProjects() {
  const scope=bridge.device?.id||'offline';
  if(!projectCollapse.has(scope)){
    let keys=[];try{const saved=JSON.parse(localStorage.getItem(`cxpalm:collapsed-projects:${scope}`)||'[]');if(Array.isArray(saved))keys=saved.filter(key=>typeof key==='string').slice(0,5000);}catch{}
    projectCollapse.set(scope,new Set(keys));
  }
  return projectCollapse.get(scope);
}
function renderLists() {
  const query=$('search').value.trim().toLocaleLowerCase();
  const rows=state.sessions.filter(item=>`${item.title||''} ${item.cwd||''} ${item.projectName||''}`.toLocaleLowerCase().includes(query));
  const nodes=[];const groups=new Map();
  const existing=new Map([...$('session-list').querySelectorAll('.session-row')].map(row=>[row.querySelector('.session-item').dataset.thread,row]));
  for(const item of rows){const key=$('list-mode').value==='projects'?(item.projectId||'none'):'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const collapsed=collapsedProjects();
  for(const [key,items] of groups){
    if(key){
      const label=items[0].projectName||'无项目',heading=text('button',`${label} · ${items.length}`,'project-heading');
      heading.type='button';heading.title=items[0].cwd||label;heading.setAttribute('aria-expanded',String(!collapsed.has(key)));
      heading.onclick=()=>{if(collapsed.has(key))collapsed.delete(key);else collapsed.add(key);try{localStorage.setItem(`cxpalm:collapsed-projects:${bridge.device?.id||'offline'}`,JSON.stringify([...collapsed]));}catch{}renderLists();};nodes.push(heading);
    }
    for(const item of items){
      const row=existing.get(item.id)||text('div','','session-row');row.hidden=!!key&&collapsed.has(key);
      const button=row.querySelector('.session-item')||text('button','','session-item');button.type='button';button.dataset.thread=item.id;button.classList.toggle('selected',state.selected?.id===item.id);
      const unread=typeof item.unread==='boolean'?item.unread:null;button.classList.toggle('is-unread',unread===true);
      const top=button.querySelector('.session-title')||text('span','','session-title');
      const label=`${item.statusSource==='history'?'历史记录 · ':''}${sessionLabels[item.status]||'状态未知'} · ${unread===true?'未读':unread===false?'已读':'阅读状态未同步'}`;
      const indicator=sessionIndicator(item.status,unread,!!item.archived);
      let status=top.querySelector('.session-status');
      if(indicator){
        if(!status){status=text('span','','session-status');top.prepend(status);}
        status.className=`session-status ${indicator}`;status.title=label;status.setAttribute('role','img');status.setAttribute('aria-label',label);
      }else status?.remove();
      button.title=label;
      const title=top.querySelector('strong')||text('strong','');title.textContent=item.title||item.id;if(!title.parentNode)top.append(title);
      const stamp=item.lastReplyAt||item.updated;
      let time=top.querySelector('time');
      if(stamp){const date=new Date(stamp*1000);if(!time){time=text('time','');top.append(time);}time.textContent=`${date.getMonth()+1}/${String(date.getDate()).padStart(2,'0')}`;time.dateTime=date.toISOString();time.title=`${item.lastReplyAt?'最后回复':'最近活动'} · ${date.toLocaleString()}`;}else time?.remove();
      if(!top.parentNode)button.append(top);
      const elapsed=button.querySelector('.session-elapsed')||text('small','','session-elapsed');
      elapsed.dataset.thread=item.id;elapsed.dataset.status=item.status;
      if(!elapsed.parentNode)button.append(elapsed);
      button.onclick=()=>run(()=>selectChat({id:item.id,title:item.title||item.id,archived:!!item.archived}));
      if(!button.parentNode)row.append(button);nodes.push(row);
    }
  }
  if(!nodes.length)nodes.push(text('p',state.archived?'没有已归档会话':'没有匹配的会话','sidebar-note'));
  const list=$('session-list'),wanted=new Set(nodes);
  for(const node of [...list.children])if(!wanted.has(node))node.remove();
  nodes.forEach((node,index)=>{if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);});
  updateSessionTimers();
  const sync=state.sessionSync;
  const syncError=bridge.connected&&typeof sync?.error==='string'?sync.error.trim():'';
  $('session-sync').hidden=!syncError;
  $('session-sync').textContent=syncError;
  $('load-more').hidden=!state.hasMore;
  $('load-more').disabled=state.listLimit>=5000;
  $('load-more').textContent=state.listLimit>=5000?'已加载 5000 条 · 请用项目或搜索缩小范围':'加载更多';
}
function applySessionPage(page){
  listTimingAnchor=Number.isFinite(page.observedAtMs)&&page.observedAtMs>0?{server:page.observedAtMs,local:performance.now()}:null;
  state.sessionSync=page.sync;state.sessions=(page.items||[]).map(row=>mergeSessionReadState(row,state.readState));state.projects=page.projects||[];state.hasMore=page.hasMore;saveReadingSoon();
  const fill=(id,includeAll)=>{const node=$(id),selected=node.value;const options=[];
    if(includeAll){const all=text('option','全部项目');all.value='';options.push(all);}
    const none=text('option',includeAll?'无项目':'无项目 · 独立工作目录');none.value='none';options.push(none);
    for(const p of state.projects){const option=text('option',p.name||p.id);option.value=p.id;options.push(option);}node.replaceChildren(...options);node.value=[...node.options].some(o=>o.value===selected)?selected:includeAll?'':node.options[0]?.value||'';};
  fill('project-filter',true);$('project-filter').value=state.project;fill('new-project',false);
  if(state.selected){const current=state.sessions.find(row=>row.id===state.selected.id);if(current){state.selected.archived=current.archived;state.selected.title=current.title||state.selected.title;state.readState=mergeSessionReadState(state.readState||{id:current.id},current);if(state.snapshot&&current.readToken===readToken&&typeof current.unread==='boolean'){state.snapshot={...state.snapshot,hasUnreadTurn:current.unread};if(!current.unread)readAttempt=null;}renderHeading();}}
  renderLists();renderControls();markVisibleRead();
}
async function refreshLists(){
  const ticket=crypto.randomUUID();state.listSubscription=ticket;
  const fields={archived:state.archived,project:state.project,text:$('search').value.trim(),limit:state.listLimit};
  const page=await bridge.command('sessions.browse',fields);
  if(ticket!==state.listSubscription)return;
  applySessionPage(page);
  await bridge.command('sessions.subscribe',fields,ticket);
}
async function selectChat(selected,navigate=true,reconnecting=false){
  ++selection;
  const changed=state.selected?.id!==selected.id;
  state.selected=selected;
  localStorage.setItem(`cxpalm:selected:${bridge.device.id}`,JSON.stringify(selected));
  if(!reconnecting || changed){
    sentUserBefore=null;historyScrollArmed=false;historyAutoRetryAt=0;state.scrollToLatest=true;pinnedToLatest=true;state.historyAttempt=null;state.history=null;state.historyPage=null;state.historyLoading=false;questionTarget=null;questionSignature='';goalDraft=false;++historyRequest;
  }
  if(changed){
    state.readState=null;
    const cached=readingCache?.get(selected.id);
    state.snapshot=cached?.snapshot||null;state.historyPage=cached?.historyPage||null;state.history=cached?.history||null;
    state.nativeSyncedAtMs=cached?.nativeSyncedAtMs||null;
    state.cached=!!state.snapshot;readToken=null;state.desktop=false;state.catalog={models:[],skills:[]};closePanels();
  }
  state.settingsBase=null;state.editGroup=null;
  $('skill-search').value='';
  $('message').value=bridge.storage.getItem(draftKey())||'';
  try{state.skills=new Set(JSON.parse(localStorage.getItem(skillStorageKey())||'[]'));}catch{state.skills=new Set();}
  if(navigate)showPage('chat');drawer(false);renderLists();renderHeading();renderConversation();renderCatalog();renderControls();renderPending();
  if(bridge.connected)await bridge.command('chat.subscribe',{thread:selected.id,stream:true});
}
function updateSessionTimers() {
  const rows=new Map(state.sessions.map(row=>[row.id,row]));
  const now=listTimingAnchor?listTimingAnchor.server+performance.now()-listTimingAnchor.local:NaN;
  for(const node of $('session-list').querySelectorAll('.session-elapsed')){
    const value=sessionElapsed(rows.get(node.dataset.thread),now,bridge.connected);
    if(node.textContent!==value)node.textContent=value;
    node.hidden=!value;
  }
}
function updateTurnTimers() {
  if (document.hidden) return;
  updateSessionTimers();
  if (state.page !== 'chat') return;
  const turns = displayedTurns();
  const byID = new Map(turns.map(turn => [turn.turnId, turn]));
  const live = bridge.connected && state.desktop && !state.cached;
  const now = timingAnchor.server + (live ? performance.now() - timingAnchor.local : 0);
  const latest=state.snapshot?.turns?.at(-1);
  const running=live && state.snapshot?.threadRuntimeStatus?.type==='active';
  $('turn-running').textContent=running?'Codex 正在工作…'+(turnElapsed(latest,now,true)?' · '+turnElapsed(latest,now,true).replace(/^执行中 · /,''):''):'';
  $('turn-running').hidden=!$('turn-running').textContent;
  for (const node of document.querySelectorAll('.turn-elapsed')) {
    const turn = byID.get(node.dataset.turn);
    node.textContent = turnElapsed(turn, now, false);
    node.hidden = !node.textContent;
  }
}
setInterval(updateTurnTimers, 1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)bridge.checkConnection();updateTurnTimers();});
window.addEventListener('pageshow',()=>bridge.checkConnection());
window.addEventListener('online',()=>bridge.checkConnection());
const processBodies=new Map(),processRequests=new Map();
function renderProcessBody(details,message){
  const body=details.querySelector('.process-body');
  if(!details.open){body.replaceChildren();delete body.dataset.revision;return;}
  const thread=state.selected?.id,key=`${bridge.device?.id}:${thread}:${message.turn}:${message.id}`;
  const cached=processBodies.get(key);
  if(message.deferred&&cached?.bodyRevision!==message.bodyRevision&&!(cached&&message.status==='inProgress')){
    if(!processRequests.has(key)&&bridge.connected){
      if(!body.childNodes.length)body.append(text('p','正在读取…','muted'));
      const request=bridge.command('chat.item',{thread,turn:message.turn,item:message.id}).then(detail=>{
        processBodies.delete(key);processBodies.set(key,detail);
        while(processBodies.size>8)processBodies.delete(processBodies.keys().next().value);
        while(processBodies.size>1&&[...processBodies.values()].reduce((n,v)=>n+(v.text?.length||0),0)>8000000)processBodies.delete(processBodies.keys().next().value);
        processRequests.delete(key);
        const current=messageNodes.get(details.dataset.messageKey)?.message;
        if(details.isConnected&&details.open&&state.selected?.id===thread&&current)renderProcessBody(details,{...current,deferred:false,text:detail.text,command:detail.command,bodyRevision:detail.bodyRevision});
      }).catch(()=>{
        processRequests.delete(key);
        if(!details.isConnected||!details.open)return;
        body.replaceChildren(text('p','读取失败，正文仍保留在电脑上。','muted'));
        const retry=text('button','重试','quiet');retry.type='button';retry.onclick=()=>renderProcessBody(details,message);body.append(retry);
      });processRequests.set(key,request);
    }else if(!bridge.connected&&!body.childNodes.length)body.append(text('p','离线缓存 · 连接后读取完整详情','muted'));
    return;
  }
  const value=message.deferred?cached:message,revision=value.bodyRevision||JSON.stringify([value.text,value.command]);
  if(body.dataset.revision===revision)return;
  body.dataset.revision=revision;body.replaceChildren();
  if(message.role==='reasoning')markdown(body,value.text);
  else {
    if(value.command&&value.command!==value.text){const command=text('pre',value.command);command.tabIndex=0;body.append(command);}
    const output=text('pre',value.text);output.tabIndex=0;body.append(output);
  }
  if(message.deferred||message.bodyRevision&&cached){
    const refresh=text('button','刷新输出','quiet');refresh.type='button';
    refresh.onclick=()=>{const current=messageNodes.get(details.dataset.messageKey)?.message;if(!current)return;processBodies.delete(key);body.replaceChildren();delete body.dataset.revision;renderProcessBody(details,current);};body.append(refresh);
  }
}

function displayedTurns() {
  const page=state.historyPage;
  if(!page)return state.snapshot?.turns||[];
  if(page.hasMore)return page.turns;
  const latest=state.snapshot?.turns||[],start=Math.max(0,(state.snapshot?.historyTotal??page.total)-latest.length);
  return mergeHistoryTurns(page.turns,latest.slice(Math.max(0,page.offset-start)));
}
function renderConversation() {
  const container = $('messages');
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 2;
  if(!atBottom&&!state.scrollToLatest)pinnedToLatest=false;
  const oldTop = container.scrollTop;
  const visibleAnchor=[...container.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>container.getBoundingClientRect().top);
  const visibleOffset=visibleAnchor?.getBoundingClientRect().top;
  const snapshot = state.snapshot;
  const messages = conversation(displayedTurns());
  for(const cached of messageNodes.values())cached.used=false;
  const nodes = messages.map((message, index) => {
    const key = `${state.selected?.id}:${message.turn}:${message.id || index}:${message.role}`;
    const old=messageNodes.get(key);
    if(old?.message===message){old.used=true;return old.node;}
    const signature=JSON.stringify(message);
    if(old?.signature===signature){old.used=true;old.node.dataset.turn=message.turn||'';return old.node;}
    const card = old?.node || document.createElement('article');
    card.className = `message${message.role === 'sessionError' ? ' session-error' : message.role === '你' ? ' user' : message.collapsible ? ' activity' : ''}`;
    card.dataset.turn=message.turn||'';card.dataset.item=message.id;card.dataset.role=message.role;
    if (!message.collapsible) {
      card.replaceChildren(text('div', message.role==='sessionError'?'本轮提示':message.role, 'message-head'));
      const body = document.createElement('div'); body.className = 'message-body';
      if(message.role==='sessionError'){body.textContent=message.text;card.setAttribute('role','status');}else markdown(body, message.text);
      card.append(body);appendImages(body,message);appendFiles(body,message);
    } else {
      let details = card.querySelector('details');
      if (!details) {
        details = document.createElement('details'); details.className = 'process-details';details.dataset.messageKey=key;
        details.open = state.openTools.has(key);
        details.append(document.createElement('summary'), text('div', '', 'message-body process-body'));
        details.addEventListener('toggle', () => { if (details.isConnected) {
          if (details.open) state.openTools.add(key); else state.openTools.delete(key);
          const current=messageNodes.get(key)?.message;if(current)renderProcessBody(details,current);
        } });
        card.append(details);
      }
      const label = message.role === 'reasoning' ? '思考摘要' : message.role === 'commandExecution' ? '执行命令' : message.role === 'fileChange' ? '文件变更' : '工具详情';
      const summary = details.querySelector('summary');
      const icon=text('span',message.role==='commandExecution'?'›_':message.role==='reasoning'?'✧':'◇','process-icon');icon.setAttribute('aria-hidden','true');
      summary.replaceChildren(icon,text('span', label, 'process-label'));
      if(message.role==='reasoning')summary.append(text('span',message.text.replace(/[#*_`\n]+/g,' ').trim(),'process-preview'));
      if (message.command) summary.append(text('code', message.command.replace(/\s+/g, ' ').trim(), 'process-command'));
      const status = ({inProgress:'进行中',completed:'已完成',failed:'失败',declined:'已拒绝'})[message.status];
      if (status) summary.append(text('span', status, `process-status${message.status === 'failed' ? ' failed' : ''}`));
      renderProcessBody(details,message);
    }
    messageNodes.set(key,{signature,message,node:card,used:true});
    return card;
  });
  const footerAt = new Map();
  messages.forEach((message,index)=>{
    if(message.role==='Codex' || (message.role!=='你' && messages[footerAt.get(message.turn)]?.role!=='Codex')) footerAt.set(message.turn,index);
  });
  for(const [key,node] of timingNodes) if(!footerAt.has(node.dataset.turn) || !key.startsWith(`${state.selected?.id}:`)) timingNodes.delete(key);
  for(const [turn,index] of [...footerAt].sort((a,b)=>b[1]-a[1])) {
    const key=`${state.selected?.id}:${turn}`;
    let footer=timingNodes.get(key);
    if(!footer){footer=text('div','','turn-elapsed');footer.dataset.turn=turn||'';footer.hidden=true;timingNodes.set(key,footer);}
    nodes.splice(index+1,0,footer);
  }
  for(const [key,cached] of messageNodes)if(!cached.used){transcriptResize.unobserve(cached.node);messageNodes.delete(key);}
  if (!nodes.length) {
    const empty = text('div','','empty');
    empty.append(text('span','↗','empty-symbol'),text('h2',state.selected?'与电脑上的工作保持同步。':'电脑上的工作，在这里继续。'),text('p',state.selected?'正在读取会话。请保持官方 Codex 桌面打开。':'从左侧选择一个会话，查看进度或继续对话。'));
    nodes.push(empty);
  }
  if(state.selected){
    const page=state.historyPage||state.history;
    const controls=text('div','','history-controls');
    const older=text('button',state.historyLoading?'正在读取…':'↑ 更早的内容','quiet');older.type='button';older.disabled=state.historyLoading||!bridge.connected||page?.offset===0;
    older.addEventListener('click',()=>run(()=>loadHistory({offset:Math.max(0,(page?.offset??state.snapshot?.historyTotal??20)-20)},true,true)));
    controls.append(older,text('span',page?(page.total?`${page.offset+1}–${page.offset+page.turns.length} / ${page.total}`:'暂无历史内容'):'完整历史可向前加载','history-position'));
    const latest=text('button','回到最新 ↓','quiet');latest.type='button';latest.disabled=state.historyLoading||!bridge.connected;
    latest.addEventListener('click',()=>run(()=>loadHistory({cursor:'latest'})));controls.append(latest);nodes.unshift(controls);
    if(state.historyPage?.hasMore){const newer=text('button','后面的内容 ↓','history-next');newer.type='button';newer.addEventListener('click',()=>run(()=>loadHistory({offset:state.historyPage.offset+state.historyPage.turns.length},true,true)));nodes.push(newer);}
  }
  // Move only changed/out-of-order nodes; leave unchanged text, selection and details intact.
  const wanted=new Set(nodes);
  for(const node of [...container.children])if(!wanted.has(node))node.remove();
  nodes.forEach((node,index)=>{if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);});
  updateTurnTimers();
  if(state.page==='chat')container.scrollTop = (atBottom || state.scrollToLatest) && !state.historyPage?.hasMore ? container.scrollHeight : oldTop;
  if(!atBottom&&!state.scrollToLatest&&visibleAnchor?.isConnected)container.scrollTop+=visibleAnchor.getBoundingClientRect().top-visibleOffset;
  if(messages.length && !state.historyPage){
    const user=messages.filter(m=>m.role==='你').at(-1);
    if(sentUserBefore===null || JSON.stringify(user)!==sentUserBefore){state.scrollToLatest=false;sentUserBefore=null;}
  }
  renderQuestionRail();
  if(questionTarget){const node=[...container.querySelectorAll('.message.user')].find(n=>n.dataset.turn===questionTarget.turn&&(!questionTarget.item||n.dataset.item===questionTarget.item));if(node){container.scrollTop+=node.getBoundingClientRect().top-container.getBoundingClientRect().top-16;node.classList.add('question-highlight');setTimeout(()=>node.classList.remove('question-highlight'),1800);}questionTarget=null;}
  for(const node of container.querySelectorAll('.message'))transcriptResize.observe(node);
  captureReadingAnchor();updateQuestionPosition();updateLatestButton();markVisibleRead();
  const approvals = snapshot?.requests || [];
  const nextApprovalSignature=JSON.stringify([state.selected?.id,approvals]);
  if(approvalSignature===nextApprovalSignature){renderControls();return;}
  approvalSignature=nextApprovalSignature;
  $('approvals').replaceChildren(...approvals.map(request => {
    const card = document.createElement('article'); card.className = 'approval';
    card.append(text('strong', '需要你确认'), text('p', request.params?.message || request.params?.command || request.params?.reason || request.method));
    const details = document.createElement('details');
    details.append(text('summary', '查看请求详情'), text('pre', JSON.stringify(request.params || {}, null, 2))); card.append(details);
    const permissionRequest=request.method==='item/permissions/requestApproval';
    if(permissionRequest) {
      details.open=true;
      card.append(text('p','仅批准请求中列出的权限，限当前轮次，不会永久授权。'));
    }
    const thread=state.selected.id,requestSignature=JSON.stringify(request);
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const decision of approvalDecisions(request)) {
      const button = text('button', decision === 'acceptForSession' ? '本会话内始终批准' : decision === 'accept' ? (permissionRequest?'批准本轮权限':'仅批准这一次') : decision==='cancel'?'取消请求':'拒绝'); button.type = 'button';
      button.addEventListener('click', () => run(async () => {
        if(state.selected?.id!==thread||!state.snapshot?.requests?.some(current=>JSON.stringify(current)===requestSignature))return;
        if(decision==='acceptForSession'&&!confirm('允许官方桌面在本会话内记住此请求对应的批准？后续匹配操作可能不再逐次询问；不会永久批准。'))return;
        if (decision === 'accept' && !confirm('仅批准这一次请求？请先核对操作详情。')) return;
        await write('chat.approve', {thread, requestId: String(request.id), decision});
      })); actions.append(button);
    }
    if (!actions.children.length) actions.append(text('p', '此类型的请求请在官方 Codex 桌面处理。'));
    card.insertBefore(actions,details); return card;
  }));
  renderControls();
}
function refreshQuestionIndex() {
  if(!bridge.connected||(!state.desktop&&!state.selected?.archived)||state.historyLoading||state.historyPage)return;
  const key=`${selection}:${state.desktop}:${state.snapshot?.turns?.at(-1)?.turnId}:${conversation(state.snapshot?.turns).findLast(message=>message.role==='你')?.id}`;
  if(state.historyAttempt!==key){state.historyAttempt=key;run(()=>loadHistory({cursor:'latest'},false));}
}
async function loadHistory(fields={cursor:'latest'},navigate=true,extend=false){
  if(!bridge.connected){if(fields.cursor==='latest'){state.historyPage=null;state.scrollToLatest=true;renderConversation();$('messages').scrollTop=$('messages').scrollHeight;}return;}

  if(extend&&state.historyLoading)return;
  historyScrollArmed=false;
  const container=$('messages');
  let anchor,anchorTop;
  const current=state.historyPage||state.history;

  const ticket=selection,thread=state.selected?.id,request=++historyRequest;
  if(!thread)return;
  state.historyLoading=true;renderConversation();
  try{
    const indexOnly=!navigate&&fields.cursor==='latest'&&state.desktop&&state.snapshot?.historySource!=='rollout';
    const page=seedHistoryIndex(await bridge.command('chat.history',{thread,limit:20,...fields,indexOnly,lazy:true}),state.snapshot,indexOnly);
    if(ticket!==selection||thread!==state.selected?.id||request!==historyRequest)return;
    if(!Array.isArray(page.turns)||!Array.isArray(page.questions))throw new Error('请更新网关以浏览完整历史。');
    anchor=extend?[...container.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>container.getBoundingClientRect().top):null;
    anchorTop=anchor?.getBoundingClientRect().top;
    state.history=page;
    const latest=fields.cursor==='latest';if(navigate)pinnedToLatest=latest;
    if(navigate)state.historyPage=latest?null:extend?extendHistory(current,page):page;
    if(latest&&state.snapshot?.historySource==='rollout')state.snapshot={...state.snapshot,turns:page.turns,historyMore:page.offset>0};
    if(navigate&&!extend){state.scrollToLatest=false;$('question-rail').classList.remove('expanded');$('question-toggle').setAttribute('aria-expanded','false');questionTarget=fields.cursor&&fields.cursor!=='latest'?{turn:fields.cursor,item:fields.item}:null;$('messages').scrollTop=latest?$('messages').scrollHeight:0;}
  }catch(error){
    if(extend&&ticket===selection&&request===historyRequest)historyAutoRetryAt=Date.now()+2000;
    throw error;
  }finally{
    if(ticket===selection&&request===historyRequest){state.historyLoading=false;rememberReading();renderConversation();if(anchor?.isConnected)container.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;historyScrollTop=container.scrollTop;if(navigate&&fields.cursor==='latest')$('messages').scrollTop=$('messages').scrollHeight;refreshQuestionIndex();}
  }
}

// Only deliberate scrolling can fetch a page; layout changes never drain all history.
function autoHistoryAtEdge(direction){
  const box=$('messages'),page=state.historyPage||state.history;
  if(!historyScrollArmed||Date.now()<historyAutoRetryAt||state.historyLoading||state.page!=='chat'||!bridge.connected||!page)return;
  let offset;
  if(direction<0&&box.scrollTop<Math.max(600,box.clientHeight)&&page.offset>0)offset=Math.max(0,page.offset-20);
  else if(direction>0&&box.scrollHeight-box.scrollTop-box.clientHeight<90&&state.historyPage?.hasMore)offset=page.offset+page.turns.length;
  if(offset!==undefined){historyScrollArmed=false;run(()=>loadHistory({offset},true,true));}
}
let historyTouchY=0;
$('messages').addEventListener('touchstart',event=>{historyTouchY=event.touches[0]?.clientY||0;},{passive:true});
$('messages').addEventListener('touchmove',event=>{const y=event.touches[0]?.clientY||0;historyScrollArmed=true;autoHistoryAtEdge(historyTouchY-y);historyTouchY=y;},{passive:true});
$('messages').addEventListener('wheel',event=>{historyScrollArmed=true;autoHistoryAtEdge(event.deltaY);},{passive:true});
$('messages').addEventListener('keydown',event=>{if(['ArrowUp','PageUp','Home','ArrowDown','PageDown','End'].includes(event.key)){historyScrollArmed=true;autoHistoryAtEdge(['ArrowUp','PageUp','Home'].includes(event.key)?-1:1);}},{passive:true});
$('messages').addEventListener('pointerdown',event=>{if(!event.target.closest('button,a,summary,input,textarea,select'))historyScrollArmed=true;},{passive:true});
$('messages').addEventListener('scroll',()=>{const top=$('messages').scrollTop,delta=top-historyScrollTop;historyScrollTop=top;autoHistoryAtEdge(delta);},{passive:true});

function rememberReading(authoritative=false){
  if(state.snapshot&&(!state.cached||authoritative))readingCache?.remember(state.selected?.id,{snapshot:state.snapshot,historyPage:state.historyPage,history:state.history,nativeSyncedAtMs:state.nativeSyncedAtMs});
  saveReadingSoon();
}
function saveReadingSoon(){
  clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>{
    readingCache?.save();
    if(!state.device)return;
    try{sessionStorage.setItem('cxpalm:reading-session',JSON.stringify({device:state.device,selected:state.selected,version:state.version,archived:state.archived,project:state.project,
      sessions:state.sessions.map(row=>({...row,live:false,status:'unknown',unread:null,readToken:undefined})),projects:state.projects}));}catch{}
  },500);
}
function clearReadingCache(){
  void mediaCache.clear().catch(()=>{});
  clearTimeout(cacheTimer);readingCache?.clear();readingCache=null;
  for(const key of Object.keys(sessionStorage))if(key.startsWith('cxpalm:reading:')||key==='cxpalm:reading-session')sessionStorage.removeItem(key);
}
function restoreOfflineReading(){
  if(state.device)return;
  try{
    const saved=JSON.parse(sessionStorage.getItem('cxpalm:reading-session')||'null');
    if(!saved?.device?.id||saved.device.expires*1000<=Date.now())return;
    state.device=saved.device;bridge.device=saved.device;state.sessions=saved.sessions||[];state.projects=saved.projects||[];state.archived=!!saved.archived;state.project=saved.project||'';state.version=saved.version||'';
    readingCache=new ReadingCache(sessionStorage,`${saved.device.id}:${saved.device.expires}`);
    $('login').hidden=true;$('shell').hidden=false;$('nav-settings').hidden=false;
    renderLists();if(saved.selected)run(()=>selectChat(saved.selected,false));
  }catch{}
}
function updateLatestButton(){
  const box=$('messages');$('jump-latest').hidden=!state.selected||!box.querySelector('.message')||(!state.historyPage?.hasMore&&box.scrollHeight-box.scrollTop-box.clientHeight<=2);
}
$('messages').addEventListener('scroll',()=>{const box=$('messages');pinnedToLatest=box.scrollHeight-box.scrollTop-box.clientHeight<=2;updateLatestButton();},{passive:true});
listen('jump-latest','click',()=>{if(state.historyPage)return loadHistory({cursor:'latest'});state.scrollToLatest=true;pinnedToLatest=true;$('messages').scrollTop=$('messages').scrollHeight;updateLatestButton();});
new ResizeObserver(updateLatestButton).observe($('messages'));

function renderQuestionRail(){
  const questions=state.history?.questions||[];
  $('question-rail').hidden=!state.selected||!questions.length;
  const signature=JSON.stringify([state.selected?.id,questions]);
  if(signature!==questionSignature){
    questionSignature=signature;
    $('question-list').replaceChildren(...questions.map((question,index)=>{
      const button=text('button','','question-stop');button.type='button';button.dataset.turn=question.turn;button.dataset.item=question.item||'';button.title=`${index+1}. ${question.text}`;button.setAttribute('aria-label',button.title);
      button.append(text('span',String(index+1),'question-number'),text('span',question.text,'question-copy'));
      button.addEventListener('click',()=>run(()=>loadHistory({cursor:question.turn,item:question.item})));return button;
    }));
    $('question-slider').max=Math.max(0,questions.length-1);$('question-slider').disabled=questions.length<2;
  }
  updateQuestionPosition();
}
function updateQuestionPosition(){
  const box=$('messages'), questions=state.history?.questions||[];
  const top=box.getBoundingClientRect().top;
  const positions=[...box.querySelectorAll('.message.user')].map(node=>({turn:node.dataset.turn,item:node.dataset.item,top:node.getBoundingClientRect().top}));
  const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<4;
  const index=activeQuestionIndex(questions,positions,top+35,atBottom,!state.historyPage?.hasMore);
  const buttons=[...$('question-list').querySelectorAll('button')];
  buttons.forEach((button,i)=>{const active=i===index;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  if(index>=0){
    if(!questionScrubbing)$('question-slider').value=index;$('question-slider').setAttribute('aria-valuetext',questions[index].text);
    const list=$('question-list'), button=buttons[index];
    if(button){
      if(!questionScrubbing){
        const offset=button.getBoundingClientRect().top-list.getBoundingClientRect().top;
        list.scrollTop+=offset-(list.clientHeight-button.offsetHeight)/2;
      }
    }
  }
}
$('messages').addEventListener('scroll',updateQuestionPosition,{passive:true});
listen('question-toggle','click',()=>{const expanded=$('question-rail').classList.toggle('expanded');$('question-toggle').setAttribute('aria-expanded',String(expanded));requestAnimationFrame(updateQuestionPosition);});
$('question-slider').addEventListener('pointerdown',()=>{questionScrubbing=true;});
$('question-slider').addEventListener('pointerup',()=>requestAnimationFrame(()=>{if(!state.historyLoading){questionScrubbing=false;updateQuestionPosition();}}));
$('question-slider').addEventListener('pointercancel',()=>{questionScrubbing=false;updateQuestionPosition();});
$('question-slider').addEventListener('input',event=>{questionScrubbing=true;const question=state.history?.questions?.[Number(event.target.value)];if(question){event.target.title=question.text;event.target.setAttribute('aria-valuetext',question.text);}});
listen('question-slider','change',async event=>{const question=state.history?.questions?.[Number(event.target.value)];try{if(question)await loadHistory({cursor:question.turn,item:question.item});}finally{questionScrubbing=false;updateQuestionPosition();}});
new ResizeObserver(()=>requestAnimationFrame(updateQuestionPosition)).observe($('question-list'));
// Preserve the visible message when expanding a tool, and follow streamed growth only at the tail.
let readingAnchor=null;
function captureReadingAnchor(){const box=$('messages'),top=box.getBoundingClientRect().top;const node=[...box.querySelectorAll('.message')].find(n=>n.getBoundingClientRect().bottom>top);readingAnchor=node?{node,offset:node.getBoundingClientRect().top-top}:null;}
$('messages').addEventListener('scroll',captureReadingAnchor,{passive:true});
const transcriptResize=new ResizeObserver(()=>{const box=$('messages');if(state.page!=='chat')return;if(pinnedToLatest&&!state.historyPage?.hasMore)box.scrollTop=box.scrollHeight;else if(readingAnchor?.node.isConnected)box.scrollTop+=readingAnchor.node.getBoundingClientRect().top-box.getBoundingClientRect().top-readingAnchor.offset;updateQuestionPosition();updateLatestButton();markVisibleRead();});transcriptResize.observe($('messages'));

async function write(method, fields, draft) {
  const receipt = await bridge.mutate(method, fields, draft);
  if (receipt.status !== 'confirmed') throw Object.assign(new Error('结果未确认。请查询原操作，不要重复发送。'), {operation:receipt.id});
  return receipt.result;
}
async function connect(reportFailure = true) {
  if (bridge.connected) return;
  const attempt = ++connectAttempt;
  clearTimeout(state.reconnect);
  state.connecting=state.device?'reconnecting':'connecting';renderControls();
  try {
    const result = await api('session');
    if (attempt !== connectAttempt || bridge.connected) return;
    uploads.cancelAll();
    if(state.device?.id!==result.device.id){readingCache?.clear();state.snapshot=null;state.selected=null;state.nativeSyncedAtMs=null;}
    readingCache=new ReadingCache(sessionStorage,`${result.device.id}:${result.device.expires}`);
    state.device = result.device;
    state.version = result.version;
    $('login').hidden = true;
    $('shell').hidden = false;
    $('nav-settings').hidden=false;
    $('device-info').replaceChildren(...[['站点', location.origin], ['当前浏览器授权', result.device.id], ['授权到期', new Date(result.device.expires * 1000).toLocaleString()], ['电脑端版本', result.version]].flatMap(([key, value]) => [text('dt', key), text('dd', value)]));
    bridge.connect(result.device);
    renderControls();
  } catch (error) {
    if (attempt !== connectAttempt || bridge.connected) return;
    state.connecting=null;
    if ([401, 403].includes(error.status)) {
      clearReadingCache();state.snapshot=null;state.cached=false;
      state.device = null;
      state.selected = null;
      bridge.disconnect();
      $('shell').hidden = true;
      $('nav-settings').hidden=true;
      $('login').hidden = false;
    } else {restoreOfflineReading();}
    if (![401,403].includes(error.status)&&state.device) state.reconnect = setTimeout(() => run(() => connect(false)), 5000);
    if (!state.device) { $('shell').hidden = true;
      $('nav-settings').hidden=true; $('login').hidden = false; }
    renderControls();
    if (!(state.snapshot&&!error.status) && (reportFailure || ![401,403].includes(error.status))) {state.connectionError=error instanceof Error?error.message:String(error);report(error);}
  }
}

async function loadCatalog(){
  const ticket=selection,id=state.selected?.id;
  if(!id)return;
  if(catalogRequest?.ticket===ticket)return catalogRequest.promise;
  const request={ticket,promise:null};catalogRequest=request;
  request.promise=bridge.command('chat.catalog',{thread:id}).then(catalog=>{
    if(ticket!==selection || state.selected?.id!==id)return;
    state.catalog=catalog;
    state.skills=new Set([...state.skills].filter(id=>catalog.skills.some(skill=>skill.id===id)));
    renderCatalog();
  }).finally(()=>{if(catalogRequest===request)catalogRequest=null;});
  return request.promise;
}
function skillStorageKey(){return `cxpalm:skills:${bridge.device?.id}:${state.selected?.id}`;}
function settingsChanges(){
  return state.settingsBase?changedSettings(state.settingsBase,{model:$('model').value,effort:$('effort').value,permission:$('permission').value,mode:$('plan-mode').value},state.editGroup):{};
}
function renderEfforts(preferred=$('effort').value){
  const model=state.catalog.models.find(model=>model.id===$('model').value);
  const values=[...new Set(['default',...(model?.efforts||[])])];
  if(state.settingsBase?.model===$('model').value&&state.settingsBase.effort&&!values.includes(state.settingsBase.effort))values.push(state.settingsBase.effort);
  $('effort').replaceChildren(...values.map(value=>{const option=text('option',effortLabel(value));option.value=value;return option;}));
  $('effort').value=values.includes(preferred)?preferred:'default';
}
function renderCatalog(){
  const current=sessionSettings(state.snapshot||{}),previous=$('model').value||current.model;
  const models=[...state.catalog.models];if(current.model&&!models.some(model=>model.id===current.model))models.unshift({id:current.model,name:current.model});
  $('model').replaceChildren(...models.map(model=>{const option=text('option',model.name||model.id);option.value=model.id;return option;}));
  if(!models.length){const option=text('option','模型未读取');option.value='';option.disabled=true;$('model').append(option);}
  $('model').value=models.some(model=>model.id===previous)?previous:current.model;
  $('catalog-source').textContent=state.catalog.source||'本地元数据目录；不读取或预览任意项目文件';
  renderEfforts($('effort').value||current.effort);renderSkills();
}
function selectCurrentSettings(group){
  state.settingsBase=sessionSettings(state.snapshot||{});if(goalDraft)state.settingsBase.mode='goal';state.editGroup=group;
  renderCatalog();$('model').value=state.settingsBase.model;renderEfforts(state.settingsBase.effort);
  $('permission').value=state.settingsBase.permission;
  $('plan-mode').querySelector('[value=goal]').disabled=state.snapshot?.goalAvailable===false;
  $('plan-mode').value=goalDraft?'goal':['default','plan'].includes(state.settingsBase.mode)?state.settingsBase.mode:'';
  $('confirm-full-access').checked=false;
}
function renderSkills(){
  const query=$('skill-search').value.toLocaleLowerCase();
  const skills=state.catalog.skills.filter(skill=>`${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query));
  $('skill-list').replaceChildren(...skills.map(skill=>{
    const label=document.createElement('label');label.className='check';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=state.skills.has(skill.id);
    const content=document.createElement('span');content.append(text('strong',skill.name),text('small',skill.description||'没有描述'));
    checkbox.addEventListener('change',()=>run(()=>{if(checkbox.checked){if(state.skills.size>=8){checkbox.checked=false;throw new Error('一次最多选择 8 个 Skill。');}state.skills.add(skill.id);}else state.skills.delete(skill.id);localStorage.setItem(skillStorageKey(),JSON.stringify([...state.skills]));renderSkillCount();}));
    label.append(checkbox,content);return label;
  }));
  if(!skills.length)$('skill-list').append(text('p','没有匹配的本地 Skill。请在电脑安装并启用后刷新。','footnote'));
  renderSkillCount();
}
function renderSkillCount(){$('skill-summary').textContent=state.skills.size?`Skill · ${state.skills.size}`:'Skill';$('skill-button').classList.toggle('active',state.skills.size>0);}
function savePreferences(){localStorage.setItem('cxpalm:preferences',JSON.stringify({complete:$('notify-complete').checked,approval:$('notify-approval').checked,sound:$('notify-sound').checked,sendKey:$('send-key').value,sendMode:$('send-mode').value}));}
function notificationStatus(){ $('notification-status').textContent='Notification' in window?`浏览器通知权限：${Notification.permission}。前台和后台标签页均使用浏览器通知，不显示站内任务提醒；仅在页面保持运行时有效。`:'此浏览器不支持浏览器通知。请使用支持通知的浏览器；不会改用站内弹窗。'; }
function restorePreferences(){
  let prefs={};try{prefs=JSON.parse(localStorage.getItem('cxpalm:preferences')||'{}');}catch{}
  $('notify-complete').checked=prefs.complete===true;$('notify-approval').checked=prefs.approval===true;$('notify-sound').checked=prefs.sound===true;
  if(['modifier','enter'].includes(prefs.sendKey))$('send-key').value=prefs.sendKey;
  if(['auto','queue','steer'].includes(prefs.sendMode))$('send-mode').value=prefs.sendMode;
  notificationStatus();
}
function playSound(){if(!soundContext||!$('notify-sound').checked)return;const oscillator=soundContext.createOscillator(),gain=soundContext.createGain();oscillator.connect(gain);gain.connect(soundContext.destination);gain.gain.value=0.08;oscillator.frequency.value=740;oscillator.start();oscillator.stop(soundContext.currentTime+0.16);}
function receiveNotification(event){
  const target=inbox;if(!target)return;
  const accept=()=>{if(target===inbox&&state.device&&target.accept(event))notify(event);};
  return navigator.locks?navigator.locks.request(target.key,accept):accept();
}
function notify(event){
  const kind=event.kind;
  if(!$(kind==='complete'?'notify-complete':'notify-approval').checked)return;
  const title=kind==='complete'?'Codex 任务已完成':'Codex 有新的待审批请求';
  if('Notification' in window&&Notification.permission==='granted'){try{const notification=new Notification(title,{body:`${location.host} · ${event.title||'请打开会话查看'}`,tag:`cxpalm:${location.host}:${event.id}`,icon:'assets/icon.svg'});notification.onclick=()=>{notification.close();window.focus();run(()=>selectChat({id:event.thread,title:event.title||event.thread}));};}catch{}}
  playSound();
}
listen('model','change',()=>{renderEfforts();renderControls();});
listen('effort','change',renderControls);
listen('plan-mode','change',renderControls);
listen('permission','change',()=>{$('confirm-full-access').checked=false;renderControls();});
listen('skill-search','input',renderSkills);
listen('session-settings','submit',async()=>{
  if(!state.selected||$('apply-settings').disabled)return;
  const ticket=selection;
  const options={expected:state.settingsBase.revision,...settingsChanges()};
  if(Object.keys(options).length===1)throw new Error('请先选择需要更改的设置。');
  if(options.permission==='full'){if(!$('confirm-full-access').checked)throw new Error('请先勾选完全访问风险确认。');options.confirmFullAccess=true;}
  if(options.mode==='goal'){goalDraft=true;closePanels();renderControls();$('message').focus();return;}
  if(goalDraft&&options.mode===sessionSettings(state.snapshot||{}).mode){goalDraft=false;closePanels();renderControls();return;}
  goalDraft=false;
  const result=await write('chat.settings',{thread:state.selected.id,options});
  if(ticket!==selection)return;
  if((result?.applied??result?.result?.applied)===false)throw new Error('官方桌面设置发生了变化，未应用；请重新打开设置后再修改。');
  state.settingsBase=null;state.editGroup=null;
  await bridge.command('chat.subscribe',{thread:state.selected.id});
  $('confirm-full-access').checked=false;
  closePanels();
});
for(const action of ['pause','resume','clear'])listen(`goal-${action}`,'click',async()=>{if(!state.selected)return;const thread=state.selected.id,ticket=selection;if(action==='clear'&&!confirm('关闭当前原生目标？不会停止当前回复。'))return;await write('chat.goal',{thread,options:{goalAction:action,expectedGoal:state.snapshot.goalRevision}});if(ticket===selection)await bridge.command('chat.subscribe',{thread});});
listen('compact','click',async()=>{if(state.selected&&!$('compact').disabled&&confirm('让官方桌面压缩当前会话上下文？这会生成上下文摘要，不是删除聊天历史。'))await write('chat.compact',{thread:state.selected.id});});
for(const id of ['notify-complete','notify-approval','notify-sound','send-key','send-mode'])listen(id,'change',()=>{savePreferences();renderControls();});
listen('enable-notifications','click',async()=>{
  if('Notification' in window&&Notification.permission==='default')await Notification.requestPermission();
  if($('notify-sound').checked){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){soundContext ||=new Audio();await soundContext.resume();playSound();}}
  notificationStatus();
});
listen('dismiss-notice', 'click', () => { $('notice').hidden = true; });
listen('login-form','submit',async()=>{
  const username=$('login-username').value.trim(),password=$('login-password').value;
  $('login-submit').disabled=true;
  uploads.cancelAll();
  try{await api('login',{username,password,remember:$('login-remember').checked});$('notice').hidden=true;$('notice-text').textContent='';await connect();}
  finally{$('login-password').value='';$('login-submit').disabled=false;}
});
listen('refresh', 'click', () => Promise.all([refreshLists(), state.selected && selectChat(state.selected,false,true)]));
let searchTimer;
listen('search','input',()=>{renderLists();clearTimeout(searchTimer);searchTimer=setTimeout(()=>run(()=>{state.listLimit=100;return refreshLists();}),250);});
listen('project-filter','change',()=>{state.project=$('project-filter').value;state.listLimit=100;return refreshLists();});
listen('list-mode','change',renderLists);
for(const [id,archived] of [['active-chats',false],['archived-chats',true]])listen(id,'click',()=>{state.archived=archived;state.listLimit=100;for(const key of ['active-chats','archived-chats']){const selected=key===id;$(key).classList.toggle('selected',selected);$(key).setAttribute('aria-pressed',String(selected));}return refreshLists();});
listen('load-more','click',()=>{state.listLimit=Math.min(5000,state.listLimit+100);return refreshLists();});
function newChatKey(){return bridge.device?`cxpalm:new-chat:${bridge.device.id}`:null;}
function savedNewChat(){try{return JSON.parse(localStorage.getItem(newChatKey())||'null');}catch{return null;}}
function rememberNewChat(){
  const saved=savedNewChat();
  if(saved?.thread!==state.selected?.id||!state.desktop||state.selected?.archived||state.cached||!state.snapshot)return;
  const defaults=newChatDefaults(state.snapshot);
  if(defaults){const next=JSON.stringify({...saved,...defaults});if(next!==JSON.stringify(saved))localStorage.setItem(newChatKey(),next);}
}
function renderNewChat(){
  const saved=savedNewChat(),inherit=$('inherit-new-chat').checked&&saved?.options;
  $('inherit-new-chat').disabled=!saved?.options;
  $('new-chat-defaults').textContent=saved?.options?`${saved.options.model} · ${effortLabel(saved.options.effort)} · ${permissionName({permissions:saved.options.permission==='auto-review'?':workspace':saved.options.permission,approvalsReviewer:saved.options.permission==='auto-review'?'auto_review':'user'})} · 通知${saved.enabled===true?'开启':saved.enabled===false?'关闭':'使用默认值'}`:'首次新建使用官方默认设置；连接后会记住本会话的设置。';
  $('new-chat-full-access').hidden=!(inherit&&saved.options.permission==='full');
}
listen('new-chat','click',()=>{$('new-chat-panel').hidden=!$('new-chat-panel').hidden;if(state.project&&state.project!=='none')$('new-project').value=state.project;$('inherit-new-chat').checked=true;$('confirm-new-chat-full-access').checked=false;renderNewChat();renderControls();});
listen('inherit-new-chat','change',()=>{$('confirm-new-chat-full-access').checked=false;renderNewChat();});
listen('new-project','change',renderControls);
listen('cancel-create','click',()=>{$('new-chat-panel').hidden=true;});
listen('create-chat','click',async()=>{
  const saved=savedNewChat(),defaults=$('inherit-new-chat').checked&&saved?.options?saved:null;
  if(defaults&&!state.createSettingsSupported)throw new Error('请更新网关以沿用新建参数，或取消沿用并使用官方默认设置。');
  const options=defaults?{model:defaults.options.model,effort:defaults.options.effort,permission:defaults.options.permission}:undefined;
  if(options?.permission==='full'){
    if(!$('confirm-new-chat-full-access').checked)throw new Error('请先确认新会话的完全访问权限，或取消沿用。');
    options.confirmFullAccess=true;
  }
  const key=newChatKey();
  const receipt=await bridge.mutate('sessions.create',{project:$('new-project').value,...(defaults?{options,...(typeof defaults.enabled==='boolean'?{enabled:defaults.enabled}:{})}:{})});
  if(receipt.status!=='confirmed')return;
  if(receipt.result?.id)localStorage.setItem(key,JSON.stringify({thread:receipt.result.id,...(defaults?{options:defaults.options,...(typeof defaults.enabled==='boolean'?{enabled:defaults.enabled}:{})}:{})}));
  $('new-chat-panel').hidden=true;state.archived=false;state.project='';state.listLimit=100;
  $('active-chats').classList.add('selected');$('active-chats').setAttribute('aria-pressed','true');$('archived-chats').classList.remove('selected');$('archived-chats').setAttribute('aria-pressed','false');
  if(receipt.result?.id)await selectChat({id:receipt.result.id,title:'新建会话',archived:false});run(refreshLists);if(receipt.result?.desktopReady===false&&!receipt.result?.opening)report('会话已创建，但尚未确认官方桌面接管。请在电脑上的 Codex 打开该会话；连接后将自动同步，不要重复创建。');
  if(receipt.result?.message)report(receipt.result.message);
});
listen('rename-chat','click',()=>{$('rename-panel').hidden=!$('rename-panel').hidden;$('rename-title').value=state.selected?.title||'';if(!$('rename-panel').hidden){$('rename-title').focus();$('rename-title').select();}});
listen('cancel-rename','click',()=>{$('rename-panel').hidden=true;$('rename-chat').focus();});
listen('rename-panel','submit',async event=>{
  event.preventDefault();const thread=state.selected?.id,title=$('rename-title').value.trim();if(!thread||!title)return;
  const receipt=await bridge.mutate('sessions.rename',{thread,text:title});
  if(receipt.status==='confirmed'){
    const confirmed=receipt.result?.title;
    if(confirmed&&state.selected?.id===thread)state.selected={...state.selected,title:confirmed};
    $('rename-panel').hidden=true;renderHeading();await refreshLists();
  }
});
listen('show-list', 'click', () => drawer(true));
listen('close-list', 'click', () => { drawer(false); $('show-list').focus(); });
listen('reconnect', 'click', connect);
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => showPage(button.dataset.page));
listen('message', 'input', () => { if (draftKey()) bridge.storage.setItem(draftKey(), $('message').value); renderControls(); });
async function submitMessage(forceQueue=false) {
  if (!state.selected || (forceQueue?$('queue-send').disabled:$('send').disabled)) return;
  const ticket=selection;
  const content = $('message').value;
  const key = draftKey();
  bridge.storage.setItem(key, content);
  if(goalDraft&&state.snapshot?.threadRuntimeStatus?.type==='active')throw new Error('目标需要在当前任务结束后开启。');
  if(goalDraft&&$('send-mode').value==='queue')throw new Error('目标模式请直接发送目标，不支持排队设置目标。');
  const method = forceQueue?'chat.queue':$('send-mode').value==='queue'&&(state.snapshot?.threadRuntimeStatus?.type==='active'||state.snapshot?.queuedMessages?.length)?'chat.queue':goalDraft?'chat.goal':$('send-mode').value==='steer'||($('send-mode').value==='auto'&&state.snapshot?.threadRuntimeStatus?.type==='active')?'chat.steer':'chat.send';
  if(method==='chat.steer'&&(!state.steerTurnSupported||!activeTurnId(state.snapshot)))throw new Error('引导未发送：请更新电脑网关并等待当前任务同步后重试。');
  if(method!=='chat.queue'){sentUserBefore=JSON.stringify(conversation(state.snapshot?.turns).filter(m=>m.role==='你').at(-1));
  state.historyPage=null;historyScrollArmed=false;++historyRequest;state.historyLoading=false;
  state.scrollToLatest=true;pinnedToLatest=true;renderConversation();}
  try{await write(method, {thread: state.selected.id, text: content, attachments:attachedFiles().map(file=>file.id), options:method==='chat.goal'?{expectedGoal:state.snapshot?.goalRevision||''}:method==='chat.steer'?{expectedTurn:activeTurnId(state.snapshot)}:undefined, skills:[...state.skills]}, {key, text: content});}
  finally{if(ticket===selection){sentUserBefore=null;state.scrollToLatest=false;goalDraft=false;}}
  renderControls();
}
listen('composer','submit',()=>submitMessage());
listen('more-tools','click',()=>{const expanded=document.querySelector('.composer-tools').classList.toggle('tools-expanded');$('more-tools').setAttribute('aria-expanded',String(expanded));});
for(const event of ['click','keyup','select','scroll'])$('message').addEventListener(event,()=>renderControls());
$('message').addEventListener('compositionstart',()=>{composing=true;renderControls();});
$('message').addEventListener('compositionend',()=>{composing=false;renderControls();});
document.addEventListener('visibilitychange',()=>renderControls());
listen('attach-file','click',()=>$('attachment-input').click());
$('attachment-input').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';run(()=>uploadFiles(files));});
$('message').addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.files||[]);if(files.length){event.preventDefault();run(()=>uploadFiles(files));}});
$('composer').addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
$('composer').addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();run(()=>uploadFiles(event.dataTransfer.files));}});
listen('notify-chat','click',async()=>{
  if($('notify-chat').disabled)return;
  const thread=state.selected.id,preference=state.snapshot?.notificationPreference,enabled=preference?.enabled!==true;
  const result=await write('chat.notifications',{thread,enabled});
  if(state.selected?.id===thread){if(state.snapshot?.notificationPreference===preference)state.snapshot={...state.snapshot,notificationPreference:result};rememberNewChat();renderControls();}
});
listen('queue-send','click',()=>submitMessage(true));
$('message').addEventListener('keydown',event=>{
  if(event.isComposing||composing)return;
  if(event.key!=='Enter')return;const enter=$('send-key').value==='enter';if((enter&&!event.shiftKey)||(event.ctrlKey||event.metaKey)){event.preventDefault();$('composer').requestSubmit();}
});
listen('stop', 'click', async () => { if (state.selected && !$('stop').disabled && confirm('停止当前会话正在运行的任务？')) await write('chat.stop', {thread: state.selected.id}); });
for(const prefix of ['pending','create-pending']) {
  listen('dismiss-'+prefix,'click',()=>bridge.dismissFailure($(prefix).dataset.operation));
  listen('check-'+prefix,'click',()=>{const id=$(prefix).dataset.operation;if(id)return bridge.checkPending(id);});
  listen('ack-'+prefix,'click',async()=>{const id=$(prefix).dataset.operation;if(id&&confirm('请先在官方桌面核对这次操作是否生效，再确认解除拦截。此操作不会重发原请求。'))await bridge.acknowledge(id);});
}
listen('logout', 'click', async () => {
  if (!confirm('撤销此浏览器授权并退出？下次连接请使用账号密码登录。未确认操作仍请在电脑核对。')) return;
  ++connectAttempt;
  uploads.cancelAll();
  await api('logout');
  clearReadingCache();

  clearTimeout(state.reconnect);
  state.device = null;
  state.selected = null;
  bridge.disconnect();
  $('shell').hidden = true;
      $('nav-settings').hidden=true; $('login').hidden = false; drawer(false); renderControls();
});
listen('theme', 'change', () => { document.documentElement.dataset.theme = $('theme').value; localStorage.setItem('cxpalm:theme', $('theme').value); });
function closePanels(){
  state.settingsBase=null;state.editGroup=null;
  for(const panel of document.querySelectorAll('.inline-panel'))panel.hidden=true;
  for(const button of document.querySelectorAll('[data-panel]'))button.setAttribute('aria-expanded','false');
}
for(const button of document.querySelectorAll('[data-panel]')){
  button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',button.dataset.panel);
  button.addEventListener('click',()=>{
    const panel=$(button.dataset.panel),open=panel.hidden;closePanels();if(!open)return;
    panel.querySelector('.panel-error')?.remove();panel.hidden=false;button.setAttribute('aria-expanded','true');
    const group={'model-button':'model','permission-button':'permission','plan-button':'plan'}[button.id];
    for(const label of $('session-settings').querySelectorAll('[data-control]'))label.hidden=label.dataset.control!==group;
    $('control-title').textContent=group==='permission'?'工具权限':group==='plan'?'协作模式':'模型与思考深度';
    if(group)selectCurrentSettings(group);
    if(group==='model'||button.id==='skill-button')run(loadCatalog);
    renderControls();
    const focus={'model-button':'model','permission-button':'permission','plan-button':'plan-mode','skill-button':'skill-search'}[button.id];
    if(focus)$(focus).focus();
  });
}
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',closePanels);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const trigger=document.querySelector('[data-panel][aria-expanded=true]');closePanels();if(trigger)trigger.focus();else if($('more-tools').getAttribute('aria-expanded')==='true'){document.querySelector('.composer-tools').classList.remove('tools-expanded');$('more-tools').setAttribute('aria-expanded','false');$('more-tools').focus();}}});
window.addEventListener('storage', () => run(() => { renderPending(); renderControls(); renderLists(); }));
window.addEventListener('pagehide',()=>uploads.cancelAll());
window.addEventListener('resize', () => { const pinned=pinnedToLatest;if (!matchMedia('(max-width:760px)').matches) drawer(false);requestAnimationFrame(()=>{if(pinned&&state.page==='chat'&&!state.historyPage){$('messages').scrollTop=$('messages').scrollHeight;markVisibleRead();}}); });
document.addEventListener('keydown', event => {
  if (!$('shell').classList.contains('list-open')) return;
  if (event.key === 'Escape') { drawer(false); $('show-list').focus(); }
  if (event.key === 'Tab') {
    const elements = [...$('sidebar').querySelectorAll('button:not(:disabled),input,a[href]')].filter(node => !node.hidden);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
run(async () => {
  const theme = localStorage.getItem('cxpalm:theme');
  if (['system', 'light', 'dark'].includes(theme)) { document.documentElement.dataset.theme = theme; $('theme').value = theme; }
  if(location.hash)history.replaceState(null,'',location.pathname);
  restorePreferences();
  await connect(false);
});

function computerShortcuts(){
  try{return JSON.parse(localStorage.getItem('cxpalm:computer-shortcuts')||'[]').filter(row=>typeof row.name==='string'&&row.name.trim()&&row.name.length<=80&&computerAddress(row.origin)===row.origin).slice(0,12);}catch{return [];}
}
function renderComputerShortcuts(){
  const rows=computerShortcuts();
  if(!rows.some(row=>row.origin===location.origin))rows.unshift({name:location.hostname,origin:location.origin});
  const current=rows.find(row=>row.origin===location.origin);
  $('computer-current').textContent=current.name;
  for(const id of ['computer-links','computer-shortcuts']){
    const list=$(id);list.replaceChildren();
    for(const row of rows){
      const item=text('div','','computer-link-row');
      const link=text('a',row.name,'computer-link');link.href=row.origin+'/cxpalm/';
      if(row.origin===location.origin){link.setAttribute('aria-current','page');link.addEventListener('click',event=>event.preventDefault());}
      const other=text('a','新标签页','computer-new-tab');other.href=row.origin+'/cxpalm/';other.target='_blank';other.rel='noopener noreferrer';
      item.append(link,other);
      if(id==='computer-shortcuts'&&row.origin!==location.origin){
        const remove=text('button','移除','quiet');remove.type='button';remove.setAttribute('aria-label',`移除 ${row.name}`);
        remove.addEventListener('click',()=>{localStorage.setItem('cxpalm:computer-shortcuts',JSON.stringify(computerShortcuts().filter(saved=>saved.origin!==row.origin)));renderComputerShortcuts();});item.append(remove);
      }
      list.append(item);
    }
  }
  $('computer-switch-note').textContent='每台电脑独立授权。切换不会停止原电脑的任务。';
}
$('computer-shortcut-form').addEventListener('submit',event=>{
  event.preventDefault();run(()=>{
    const origin=computerAddress($('computer-address').value),name=$('computer-name').value.trim();
    if(!name||name.length>80)throw new Error('请填写不超过 80 字的电脑名称。');
    const rows=computerShortcuts().filter(row=>row.origin!==origin);if(rows.length>=12)throw new Error('最多保存 12 台电脑快捷入口。');
    localStorage.setItem('cxpalm:computer-shortcuts',JSON.stringify([...rows,{name,origin}]));renderComputerShortcuts();$('computer-shortcut-form').reset();
  });
});
$('computer-manage').addEventListener('click',()=>{$('computer-switch').open=false;showPage('settings');$('computer-shortcut-settings').open=true;$('computer-name').focus();});
$('computer-switch').addEventListener('toggle',()=>{if($('computer-switch').open)renderComputerShortcuts();});
renderComputerShortcuts();

document.addEventListener('pointerdown',event=>{if(!$('computer-switch').contains(event.target))$('computer-switch').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('computer-switch').open){$('computer-switch').open=false;$('computer-switch').querySelector('summary').focus();}});
