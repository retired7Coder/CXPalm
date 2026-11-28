const {EventEmitter}=require('node:events');
exports.create=()=>{
 const client=new EventEmitter();let running=false,policy={enabled:false,entries:[]},diagnosedAt=0,desktopConnected=null;let logs=[];
 let login={configured:false,username:'',revision:''};
 let devices=[{id:'a'.repeat(32),name:'Pixel 9 · 我的手机',created:1792100000,expires:1892100000,revoked:false},{id:'b'.repeat(32),name:'浏览器 <img src=x onerror=alert(1)>',created:1792000000,expires:1892000000,revoked:false}];
 const connectionQRCode='data:image/png;base64,'+require('node:fs').readFileSync(require('node:path').join(__dirname,'../../internal/control/testdata/computer-qr.png')).toString('base64');
 const status=()=>({version:'0.1.0',state:running?'running':'stopped',owned:running,origin:'https://cxpalm.example.test',connectionURL:'https://cxpalm.example.test/cxpalm/',connectionQRCode,listen:'127.0.0.1:18789',codexHome:'C:\\Users\\preview\\.codex',sshConfigured:true,trustedProxyIP:true,desktopConnected,diagnosedAt,sessions:{active:13,archived:8},devices:devices.filter(d=>!d.revoked).length});
 client.request=async(method,args={})=>{
  if(method==='login.get')return login;
  if(method==='login.set'){login={configured:true,username:args.login.username,revision:'c'.repeat(64)};return login;}
  if(method==='start'){running=true;diagnosedAt=0;desktopConnected=null;}
  if(method==='stop'){running=false;diagnosedAt=0;desktopConnected=null;}
  if(method==='diagnose'){diagnosedAt=Date.now();desktopConnected=true;}
  if(method==='devices.revoke'){const device=devices.find(d=>d.id===args.device);devices=devices.map(d=>d.id===args.device?{...d,revoked:true}:d);logs.unshift({device:args.device,name:device?.name||'',action:'revoked',at:Math.floor(Date.now()/1000),ip:''});}
  if(method==='device.logs')return logs;
  if(method==='ip-policy.get')return policy;
  if(method==='ip-policy.set'){policy=args.policy;logs.unshift({name:'IP 白名单',action:policy.enabled?'ip_policy_enabled':'ip_policy_disabled',at:Math.floor(Date.now()/1000),ip:''});return policy;}
  if(method==='devices'||method==='devices.revoke')return devices;
  return status();
 };
 client.close=async()=>{running=false;client.emit('closed');};return client;
};

exports.updateOptions=()=>{
 const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
 const bytes=Buffer.from('CXPalm isolated update fixture - NOT AN EXECUTABLE');
 const manifest={schema:1,appId:'dev.cxpalm.desktop',platform:'win32',arch:'x64',version:'0.1.1',url:'https://github.com/702165405/CXPalm/releases/download/v0.1.1/CXPalm-Setup-0.1.1-x64.exe',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),notes:'隔离更新演示：配置保留与体验优化。<img src=x onerror=alert(1)> 此处仅为文本。'};
 return {platform:'win32',arch:'x64',fetch:async url=>{const body=url.endsWith('.json')?Buffer.from(JSON.stringify(manifest)):bytes;const stream=Readable.from([body]);stream.headers={'content-length':String(body.length)};return stream;}};
};
