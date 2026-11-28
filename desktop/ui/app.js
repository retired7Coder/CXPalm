(async()=>{
const $=id=>document.getElementById(id);
const api=window.cxDesktop;
document.documentElement.dataset.platform=api.platform;
const initialLanguage=await api.getLanguage();
const languageUI=CXPalmI18n.create(initialLanguage.messages,initialLanguage.language);
const tr=(value,...args)=>languageUI.tr(value,...args);
const staticText=[],staticAttributes=[];
const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
for(let node;node=walker.nextNode();)if(node.nodeValue.trim()&&node.parentElement?.closest('svg,select')===null)staticText.push([node,node.nodeValue]);
for(const node of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))for(const attr of ['title','aria-label','placeholder','alt'])if(node.hasAttribute(attr))staticAttributes.push([node,attr,node.getAttribute(attr)]);
function localizeStatic(){
 document.documentElement.lang=languageUI.code;
 for(const [node,value] of staticText)if(node.isConnected)node.nodeValue=tr(value);
 for(const [node,attr,value] of staticAttributes)if(node.isConnected)node.setAttribute(attr,tr(value));
 $('desktop-language').value=languageUI.code;
}
localizeStatic();
let state={state:'unconfigured'},currentPage='overview',busy=false,backgroundRefresh=null,revoking='',lastError='',policyDirty=false;
let savedSettings=null,connectionDirty=false,startupDirty=false,loginSettings=null,loginDirty=false;
let update={phase:'idle',currentVersion:'0.0.1',supported:false,release:null,message:tr('正在读取更新状态')};
const events=[];
const titles={overview:['YOUR PERSONAL BRIDGE',tr('一切，就绪于此。')],connect:['CONNECT YOUR NEXT SCREEN',tr('连接，从这里开始。')],devices:['ONLY THE DEVICES YOU TRUST',tr('每一份授权，都由你决定。')],diagnostics:['LOCAL CONNECTION HEALTH',tr('连接状态，一目了然。')],settings:['MAKE IT YOUR CONNECTION',tr('连接与启动，按你的习惯。')],updates:['KEEP YOUR DESKTOP UP TO DATE',tr('新体验，从这里抵达。')]};
const errors={
 'Agent port is occupied; the existing process was not changed':tr('Agent 端口已被占用。现有进程未改动，请使用外部实例或先手动退出它。'),
 'No Agent owned by this window; external processes are never stopped':tr('没有由此窗口管理的 Agent。为避免影响现有连接，不会停止外部实例。'),
 'Trusted proxy IP forwarding is not configured':tr('反向代理尚未安全配置客户端 IP 转发，请先完成代理配置。'),
 'Cannot enable IP policy for an external Agent; start the updated Agent from this window first':tr('不能保证外部 Agent 执行白名单。请先退出外部旧版，从本窗口启动新 Agent。'),
 'An enabled IP whitelist must contain an address or CIDR':tr('开启白名单前，至少填写一个 IP 或网段。'),
};
function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function icon(name){const node=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#icon-'+name);node.append(use);return node;}
function notify(message){message=localMessage(message);$('notice-text').textContent=message;$('notice').hidden=false;}
let toastTimer;
function toast(message){message=tr(message);$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2400);}
function activity(message){events.unshift({message,time:new Date()});events.splice(4);renderActivity();}
function renderActivity(){$('activity-list').replaceChildren(...events.map(item=>{const li=text('li',tr(item.message));li.append(text('time',item.time.toLocaleTimeString(languageUI.locale(),{hour:'2-digit',minute:'2-digit'})));return li;}));}
function navigate(page){currentPage=page;document.querySelectorAll('[data-view]').forEach(node=>node.hidden=node.dataset.view!==page);document.querySelectorAll('[data-page]').forEach(node=>{node.classList.toggle('selected',node.dataset.page===page);if(node.dataset.page===page)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});$('page-eyebrow').textContent=tr(titles[page][0]);$('page-title').textContent=tr(titles[page][1]);render();if(page==='devices')void run(loadDevices);if(page==='settings')void run(loadSettings);if(page==='updates')void updateAction(async()=>setUpdate(await api.updateStatus()));}
function setState(value){state=value||{state:'unconfigured'};render();}
function render(){
 const configured=!!state.origin,running=state.state==='running',occupied=state.state==='occupied';
 const names={unconfigured:tr('尚未配置'),stopped:tr('Agent 已停止'),running:tr('Agent 运行中'),occupied:tr('外部端口占用'),error:tr('配置加载失败')};
 $('global-status').className='status-badge '+(running?'running':occupied?'occupied':'');$('global-status').lastElementChild.textContent=names[state.state]||tr('等待连接');
 $('start').hidden=running;$('stop').hidden=!running;$('start').disabled=busy||!configured||occupied;$('stop').disabled=busy;
 $('hero-config').hidden=running;
 $('hero-description').textContent=running?tr('Agent 已启动，连接现在由此窗口管理。会话始终由官方 Codex 桌面执行。'):occupied?tr('检测到监听中的外部进程。本窗口不会接管或停止它，请先确认该进程是你的 CXPalm Agent。'):configured?tr('配置已载入。启动 Agent 后，让手机继续电脑上的会话；不会启动第二个会话执行器。'):tr('打开连接设置，填写 HTTPS 地址和远程服务器，然后启动网关。已有配置也可以导入。');
 $('owner-note').textContent=running?tr('关闭窗口会收至托盘；从托盘退出将停止本窗口的 Agent。'):occupied?tr('可查看会话与管理登录授权，但请自行确认外部 Agent 可用。'):tr('不会自动启动服务或接管其他进程。');
 for(const [id,value] of [['active-count',state.sessions?.active],['archive-count',state.sessions?.archived],['device-count',state.devices],['nav-devices',state.devices]])$(id).textContent=state.sessions?.error&&id.includes('count')&&id!=='device-count'?'—':value??'—';
 $('version').textContent='v'+(update.currentVersion||'0.0.1');$('fixture-label').hidden=!state.fixture;
 $('address').textContent=configured?state.origin+'/cxpalm/':tr('保存连接设置后显示');
 const qr=typeof state.connectionQRCode==='string'&&state.connectionQRCode.startsWith('data:image/png;base64,')?state.connectionQRCode:'';
 $('computer-qr').hidden=!qr;$('computer-qr-missing').hidden=!!qr;
 if(qr&&$('computer-qr').getAttribute('src')!==qr)$('computer-qr').src=qr;
 if(!qr)$('computer-qr').removeAttribute('src');
 $('computer-qr-address').textContent=qr?state.connectionURL||'':'';
 $('config-path').textContent=state.configPath||tr('尚未选择');$('codex-home').textContent=state.codexHome||'—';$('listen').textContent=state.listen||'—';$('tunnel').textContent=configured?(state.sshConfigured?tr('已配置 SSH 反向隧道（不代表已连通）'):tr('未配置 SSH 反向隧道')):'—';
 for(const id of ['copy-address','open-web','reload-devices','diagnose'])$(id).disabled=busy||!configured;
 $('refresh').disabled=busy;$('refresh').setAttribute('aria-busy',String(busy));$('refresh-label').textContent=busy?(currentPage==='diagnostics'?tr('检测中'):tr('刷新中')):(currentPage==='diagnostics'?tr('重新检测'):tr('刷新状态'));$('refresh').setAttribute('aria-label',currentPage==='diagnostics'?tr('重新检测连接'):tr('刷新状态'));
 $('save-policy').disabled=busy||!configured;$('policy-enabled').disabled=busy||!configured;$('policy-entries').disabled=busy||!configured;
 $('choose-config').disabled=busy||running;$('hero-config').disabled=busy;
 renderSettings();
 const diagnostic=CXPalmDiagnostics.view(state);
 const actionLabels={overview:tr('查看总览'),settings:tr('连接设置'),diagnose:tr('重新检测'), 'open-web':tr('打开网页检查')};
 $('checks').replaceChildren(...diagnostic.rows.map(check=>{
  const row=text('div','','check diagnostic-check');row.dataset.check=check.id;
  const evidence=text('div','','check-evidence');evidence.append(text('span',tr(check.label)),text('p',tr(check.detail)));
  const result=text('div','','check-result'),action=text('button',actionLabels[check.action],'text-button');action.type='button';action.disabled=busy;
  action.addEventListener('click',()=>{if(check.action==='settings'||check.action==='overview')navigate(check.action);else $(check.action==='diagnose'?'diagnose':'open-web').click();});
  result.append(text('strong',tr(check.value),check.tone),action);row.append(evidence,result);return row;
 }));
 $('diagnostic-time').textContent=diagnostic.checkedAt?tr('最近检测：{0} · 未发送消息或修改会话',new Date(diagnostic.checkedAt).toLocaleString(languageUI.locale()))+(diagnostic.stale?tr(' · 已超过 5 分钟，请重新检测'):''):tr('尚未主动检测官方桌面连接');
 $('diagnostic-guidance').textContent=tr(diagnostic.guidance);
}
// Polling leaves forms editable; manual actions wait for an outstanding read.
async function run(fn){if(busy)return;busy=true;render();try{await backgroundRefresh;await fn();}catch(error){notify(errors[error.message]||error.message||tr('操作未完成，请刷新状态。'));}finally{busy=false;render();}}
function refreshInBackground(){if(busy||backgroundRefresh)return;backgroundRefresh=refresh().catch(error=>notify(errors[error.message]||error.message||tr('操作未完成，请刷新状态。'))).finally(()=>{backgroundRefresh=null;});}
async function refresh(){setState(await api.invoke('status'));if(state.startupError&&state.startupError!==lastError){lastError=state.startupError;notify(state.startupError);}if(state.error&&state.error!==lastError){lastError=state.error;notify(state.error);}if(currentPage==='devices')await loadDevices();}
function switchDeviceTab(logs){
 $('active-device-panel').hidden=logs;$('device-log-panel').hidden=!logs;
 for(const [id,selected] of [['tab-active',!logs],['tab-logs',logs]]){$(id).classList.toggle('selected',selected);$(id).setAttribute('aria-selected',String(selected));}
}
async function loadDevices(){
 const [list,logs,policy]=await Promise.all([api.invoke('devices'),api.invoke('device.logs'),api.invoke('ip-policy.get')]);
 const valid=Array.isArray(list)?list.filter(device=>!device.revoked&&device.expires*1000>Date.now()):[];
 $('valid-device-count').textContent=valid.length;
 const rows=valid.map(device=>{
  const row=text('div','','device-row'),symbol=text('div','','device-icon');symbol.append(icon('phone'));
  const info=text('div','','device-info');info.append(text('h3',device.name||tr('未命名设备')),text('p',tr('授权于 ')+new Date(device.created*1000).toLocaleDateString(languageUI.locale())+tr(' · 最近来源：')+(device.lastIp||tr('旧版未记录'))));
  row.append(symbol,info,text('span',tr('有效授权'),'device-state'));
  const button=text('button',tr('撤销授权'),'text-button red-text');button.addEventListener('click',()=>{revoking=device.id;$('revoke-name').textContent=device.name||tr('未命名设备');$('revoke-dialog').showModal();});row.append(button);return row;
 });
 if(!rows.length){const empty=text('div','','empty-state');empty.append(icon('phone'),text('h3',tr('目前没有有效授权')),text('p',tr('已撤销、过期及历史记录请查看“授权日志”；新设备请使用账号密码登录。')));rows.push(empty);}
 $('devices-list').replaceChildren(...rows);
 const names={login:tr('账号登录'),login_settings_changed:tr('更新登录账号'),paired:tr('历史设备授权'),connected:tr('连接已验证'),revoked:tr('撤销授权'),ip_policy_enabled:tr('开启 / 更新 IP 白名单'),ip_policy_disabled:tr('关闭 IP 白名单'),legacy_paired:tr('旧版授权创建记录'),legacy_revoked:tr('旧版授权（现已撤销；撤销时间未记录）'),legacy_expired:tr('旧版授权（现已过期）')};
 const eventRows=Array.isArray(logs)?logs.map(event=>{const row=text('div','','device-log');const detail=text('div','');detail.append(text('strong',names[event.action]||tr('授权事件')),text('p',event.name||tr('本机管理')));row.append(text('time',event.at?new Date(event.at*1000).toLocaleString(languageUI.locale()):tr('时间未记录')),detail,text('code',event.ip||tr('未记录远端 IP')));return row;}):[];
 $('device-logs').replaceChildren(...(eventRows.length?eventRows:[text('p',tr('还没有授权日志。'),'empty-state')]));
 if(!policyDirty){$('policy-enabled').checked=!!policy.enabled;$('policy-entries').value=(policy.entries||[]).join('\n');}
 $('policy-toggle-label').textContent=$('policy-enabled').checked?tr('开启'):tr('关闭');
 $('policy-status').textContent=policyDirty?tr('有未保存的修改，点击保存后生效'):policy.enabled?tr('已保存：启用 · 登录和会话 API 均受限'):tr('已保存：关闭 · 不按 IP 限制')+(state.sshConfigured&&!state.trustedProxyIP?tr('；可信代理 IP 转发未配置'):'');
}

async function chooseConfig(){const result=await api.chooseConfig();if(result){policyDirty=false;connectionDirty=false;savedSettings=null;loginSettings=null;loginDirty=false;$('account-password').value='';$('account-confirm').value='';setState(result);if(currentPage==='settings')await loadSettings();activity(tr('已选择本机配置'));toast(tr('配置已载入；Agent 不会自动启动'));}}
$('start').addEventListener('click',()=>run(async()=>{setState(await api.invoke('start'));activity(tr('Agent 已启动，由本窗口管理'));}));
$('stop').addEventListener('click',()=>run(async()=>{const result=await api.invoke('stop');setState(result);if(!result.stopCancelled)activity(tr('本窗口的 Agent 已停止'));}));
for(const id of ['choose-config','import-config'])$(id).addEventListener('click',()=>run(chooseConfig));
$('hero-config').addEventListener('click',()=>navigate('settings'));
$('go-login-settings').addEventListener('click',()=>navigate('settings'));
$('go-connect').addEventListener('click',()=>navigate('connect'));
$('go-devices').addEventListener('click',()=>navigate('devices'));

document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();navigate('overview');});
for(const button of document.querySelectorAll('[data-page]'))button.addEventListener('click',()=>navigate(button.dataset.page));
async function diagnose(){setState(await api.invoke('diagnose'));activity(tr('只读连接诊断已完成'));}
$('refresh').addEventListener('click',()=>run(async()=>{if(currentPage==='diagnostics')await diagnose();else if(currentPage==='settings'){await refresh();await loadSettings();}else await refresh();toast(tr('状态已更新'));}));
$('reload-devices').addEventListener('click',()=>run(loadDevices));
$('open-web').addEventListener('click',()=>run(()=>api.openWeb()));
$('copy-address').addEventListener('click',()=>run(async()=>{await api.copy('address');toast(tr('控制端地址已复制'));}));
$('diagnose').addEventListener('click',()=>run(diagnose));
$('cancel-revoke').addEventListener('click',()=>$('revoke-dialog').close());
$('confirm-revoke').addEventListener('click',()=>run(async()=>{await api.invoke('devices.revoke',{device:revoking});$('revoke-dialog').close();await refresh();activity(tr('已撤销一台设备的授权'));toast(tr('设备授权已撤销'));}));
$('dismiss-notice').addEventListener('click',()=>$('notice').hidden=true);
activity(tr('控制台已就绪，尚未启动 Agent'));
void run(refresh);
setInterval(refreshInBackground,5000);

api.onChanged(refreshInBackground);

$('tab-active').addEventListener('click',()=>switchDeviceTab(false));$('tab-logs').addEventListener('click',()=>switchDeviceTab(true));
$('policy-enabled').addEventListener('change',()=>{policyDirty=true;$('policy-toggle-label').textContent=$('policy-enabled').checked?tr('开启'):tr('关闭');$('policy-status').textContent=tr('有未保存的修改，点击保存后生效');});
$('policy-entries').addEventListener('input',()=>{policyDirty=true;$('policy-status').textContent=tr('有未保存的修改，点击保存后生效');});
$('save-policy').addEventListener('click',()=>run(async()=>{
 const policy={enabled:$('policy-enabled').checked,entries:$('policy-entries').value.split(/[\n,]+/).map(value=>value.trim()).filter(Boolean)};
 if(policy.enabled&&!policy.entries.length)throw new Error(tr('开启白名单前至少填写一个 IP 或网段。'));
 await api.invoke('ip-policy.set',{policy});policyDirty=false;await loadDevices();activity(policy.enabled?tr('已启用 IP 白名单'):tr('已关闭 IP 白名单'));toast(tr('访问策略已保存'));
}));

for(const id of ['tab-active','tab-logs'])$(id).addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const logs=id==='tab-active';switchDeviceTab(logs);$(logs?'tab-logs':'tab-active').focus();}});

function renderSettings(){
 for(const id of ['account-username','account-password','account-confirm','save-account'])$(id).disabled=busy||!loginSettings||!state.origin;

 const running=state.owned===true,ready=!!savedSettings;
 for(const id of ['setting-origin','setting-ssh-enabled','save-connection'])$(id).disabled=busy||running||!ready;
 for(const id of ['setting-host','setting-user','setting-ssh-port','setting-remote-port'])$(id).disabled=busy||running||!ready||!$('setting-ssh-enabled').checked;
 for(const id of ['setting-login-start','setting-app-start','setting-start-minimized','save-startup'])$(id).disabled=busy||!ready;
 $('setting-login-start').disabled=busy||!ready||!savedSettings?.startupSupported;
 $('reload-settings').disabled=busy;$('import-config').disabled=busy||running;
 if(ready)$('connection-save-status').textContent=running?tr('网关运行中，请先停止再保存连接设置。'):connectionDirty?tr('有未保存的连接修改'):tr('已读取本机设置 · 保存不会启动网关');
}
async function loadSettings(force=false){
 if(state.state!=='unconfigured'){
   const value=await api.invoke('login.get');loginSettings=value;
   if(!loginDirty||force)$('account-username').value=value.username||'';
   $('account-status').textContent=value.configured?tr('已设置账号：{0} · 保存新密码将退出旧设备',value.username):tr('尚未设置登录账号，请在本机创建');
 }
 const value=await api.getSettings();
 if(!connectionDirty||force){
   savedSettings=value;connectionDirty=false;
   $('setting-origin').value=value.origin;$('setting-ssh-enabled').checked=value.sshEnabled;
   $('setting-host').value=value.sshHost;$('setting-user').value=value.sshUser;
   $('setting-ssh-port').value=value.sshPort||'';$('setting-remote-port').value=value.sshRemotePort;
   $('settings-config-path').textContent=value.configPath;
 }
 if(!startupDirty||force){
   startupDirty=false;$('setting-login-start').checked=value.loginAutoStart;$('setting-app-start').checked=value.appAutoStart;$('setting-start-minimized').checked=value.startMinimized;
   $('startup-save-status').textContent=tr('已保存：登录启动{0} · 打开 App 启动{1} · 启动后最小化{2}。下次对应启动时生效。',value.loginAutoStart?tr('开启'):tr('关闭'),value.appAutoStart?tr('开启'):tr('关闭'),value.startMinimized?tr('开启'):tr('关闭'));
 }
 renderSettings();
}
for(const id of ['setting-origin','setting-ssh-enabled','setting-host','setting-user','setting-ssh-port','setting-remote-port'])$(id).addEventListener(id==='setting-ssh-enabled'?'change':'input',()=>{connectionDirty=true;renderSettings();});
for(const id of ['setting-login-start','setting-app-start','setting-start-minimized'])$(id).addEventListener('change',()=>{startupDirty=true;$('startup-save-status').textContent=tr('有未保存的启动修改。保存不会立即启动网关。');});
$('reload-settings').addEventListener('click',()=>run(()=>loadSettings(true)));
$('connection-form').addEventListener('submit',event=>{
 event.preventDefault();void run(async()=>{
   const result=await api.saveConnection({revision:savedSettings.revision,origin:$('setting-origin').value,sshEnabled:$('setting-ssh-enabled').checked,sshHost:$('setting-host').value,sshUser:$('setting-user').value,sshPort:Number($('setting-ssh-port').value||0),sshRemotePort:Number($('setting-remote-port').value)});
   connectionDirty=false;policyDirty=false;setState(result.state);await loadSettings();activity(tr('连接设置已保存，未启动网关'));
   if(result.state.error)notify(tr('配置已保存，但管理连接未就绪。')+result.state.error);else toast(tr('连接设置已保存；网关不会自动启动'));
 });
});
$('save-startup').addEventListener('click',()=>run(async()=>{
 const value=await api.saveStartup({loginAutoStart:$('setting-login-start').checked,appAutoStart:$('setting-app-start').checked,startMinimized:$('setting-start-minimized').checked});
 startupDirty=false;$('setting-login-start').checked=value.loginAutoStart;$('setting-app-start').checked=value.appAutoStart;$('setting-start-minimized').checked=value.startMinimized;
 $('startup-save-status').textContent=tr('已保存：登录启动{0} · 打开 App 启动{1} · 启动后最小化{2}。下次对应启动时生效。',value.loginAutoStart?tr('开启'):tr('关闭'),value.appAutoStart?tr('开启'):tr('关闭'),value.startMinimized?tr('开启'):tr('关闭'));
 activity(tr('启动与窗口选项已独立保存'));toast(tr('启动设置已保存，下次对应启动时生效'));
}));

for(const id of ['account-username','account-password','account-confirm'])$(id).addEventListener('input',()=>{loginDirty=true;});
$('login-settings-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
 const password=$('account-password').value;
 try{
  if(password!==$('account-confirm').value)throw new Error(tr('两次输入的密码不一致。'));
  loginSettings=await api.invoke('login.set',{login:{username:$('account-username').value.trim(),password,expected:loginSettings.revision||''}});
  loginDirty=false;$('account-status').textContent=tr('登录账号已保存 · 网页和 App 可使用账号密码登录');activity(tr('登录账号已更新'));toast(tr('登录账号已保存'));
 }finally{$('account-password').value='';$('account-confirm').value='';}
});});

function setUpdate(value){update=value;renderUpdate();$('version').textContent='v'+update.currentVersion;}
function renderUpdate(){
 const phases={idle:tr('尚未检查'),checking:tr('检查中'),current:tr('已是最新'),available:tr('发现新版本'),downloading:tr('下载中'),ready:tr('等待安装'),error:tr('暂不可用'),unsupported:tr('暂不支持'),installing:tr('准备安装')};
 const working=['checking','downloading','installing'].includes(update.phase),release=update.release;
 $('update-phase').textContent=phases[update.phase]||tr('等待检查');$('update-current').textContent='v'+update.currentVersion;$('update-latest').textContent=release?'v'+release.version:update.phase==='current'?tr('与当前一致'):'—';
 $('update-message').textContent=localMessage(update.message||'');$('update-notes').textContent=release?.notes||tr('发现新版本后，说明会显示在这里。');
 $('update-size').hidden=!release;$('update-size').textContent=release?(release.size/1048576).toFixed(1)+' MB · Windows x64':'';
 $('check-update').disabled=working||!update.supported;$('download-update').hidden=!release||!['available','error'].includes(update.phase);$('download-update').disabled=working;
 $('cancel-update').hidden=update.phase!=='downloading';$('install-update').hidden=update.phase!=='ready';$('install-update').disabled=working;
 $('update-progress-wrap').hidden=update.phase!=='downloading';$('update-progress').value=update.percent||0;$('update-progress-text').textContent=(update.percent||0)+'%';
 const badge=['available','downloading','ready'].includes(update.phase);$('nav-update').textContent=badge?'NEW':'06';$('nav-update').classList.toggle('update-available',badge);
 $('update-time').textContent=(update.lastChecked?tr('最近检查：')+new Date(update.lastChecked).toLocaleString(languageUI.locale())+'。':'')+tr('启动或打开窗口时自动检查，自动检查至少间隔 6 小时；不会自动下载。');
}
async function updateAction(fn){try{await fn();}catch(error){notify(error.message||tr('更新操作未完成，请重试。'));}}
$('go-updates').addEventListener('click',()=>navigate('updates'));
$('check-update').addEventListener('click',()=>updateAction(async()=>setUpdate(await api.checkUpdate())));
$('download-update').addEventListener('click',()=>updateAction(async()=>setUpdate(await api.downloadUpdate())));
$('cancel-update').addEventListener('click',()=>updateAction(async()=>setUpdate(await api.cancelUpdate())));
$('install-update').addEventListener('click',()=>updateAction(async()=>setUpdate(await api.installUpdate())));
api.onUpdate(setUpdate);void updateAction(async()=>setUpdate(await api.updateStatus()));

function localMessage(value){
 const raw=String(value||'').replace(/^Error invoking remote method '[^']+': Error: /,'');
 const translated=tr(errors[raw]||raw);if(translated!==raw)return translated;
 for(const prefix of ['配置校验失败：','自动启动网关未完成：','配置已保存，但管理连接未就绪。'])if(raw.startsWith(prefix))return tr(prefix)+tr(raw.slice(prefix.length));
 return raw;
}
$('desktop-language').addEventListener('change',async()=>{
 const select=$('desktop-language'),before=languageUI.code;select.disabled=true;
 try{
   const value=await api.setLanguage(select.value);languageUI.set(value.language);localizeStatic();
   for(const id of ['diagnostic-time','policy-status','startup-save-status','notice-text','toast'])$(id).textContent=localMessage($(id).textContent);
   renderActivity();
   navigate(currentPage);renderUpdate();toast(tr('语言已保存'));
 }catch(error){select.value=before;notify(error.message);}finally{select.disabled=false;}
});

})().catch(error=>{console.error(error);});

