const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {Readable}=require('node:stream');
const {readJSON,atomicJSON}=require('./settings.cjs');
const RELEASES='https://github.com/702165405/CXPalm/releases/download';
const FEED='https://raw.githubusercontent.com/retired7Coder/CXPalm/main/updates/desktop-download.json';
const MAX_SIZE=512*1024*1024;
function versionParts(value){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value))throw new Error('更新版本号无效。');
  return value.split('.').map(Number);
}
function newer(candidate,current){const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
function validateManifest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.schema!==1||raw.appId!=='dev.cxpalm.desktop'||raw.platform!=='win32'||raw.arch!=='x64')throw new Error('更新清单与当前桌面应用不匹配。');
  versionParts(raw.version);
  if(raw.build!==undefined&&(!Number.isSafeInteger(raw.build)||raw.build<1||raw.build>2147483647||raw.releaseLine!=='fresh-001'))throw new Error('更新构建标识无效。');
  const suffix=raw.build===undefined?'':`-build${raw.build}`;
  const expected=`${RELEASES}/v${raw.version}${suffix}/CXPalm-Setup-${raw.version}${suffix}-x64.exe`;
  if(raw.url!==expected)throw new Error('更新下载地址不在固定发布范围内。');
  if(!Number.isSafeInteger(raw.size)||raw.size<1||raw.size>MAX_SIZE||typeof raw.sha256!=='string'||! /^[a-f0-9]{64}$/i.test(raw.sha256)||typeof raw.notes!=='string'||raw.notes.length>8000)throw new Error('更新清单的大小、校验值或说明无效。');
  if(raw.releaseLine!==undefined&&(typeof raw.releaseLine!=='string'||!/^[a-z0-9-]{1,40}$/.test(raw.releaseLine)))throw new Error('更新发布系列无效。');
  return Object.freeze({...(raw.build===undefined?{}:{build:raw.build}),...(raw.releaseLine?{releaseLine:raw.releaseLine}:{}),version:raw.version,url:expected,size:raw.size,sha256:raw.sha256.toLowerCase(),notes:raw.notes});
}
function releaseAsset(url){return /^https:\/\/github\.com\/(?:702165405|retired7Coder)\/CXPalm\/releases\/download\/v\d+\.\d+\.\d+(?:-build\d+)?\/CXPalm-[A-Za-z0-9._-]+\.exe$/.test(url);}
function redirectURL(from,location){
  const previous=new URL(from);
  if(!releaseAsset(from)&&!cdnAsset(previous))throw new Error('更新跳转来源不受信任。');
  if(typeof location!=='string'||location.length>16384)throw new Error('更新跳转地址无效。');
  const next=new URL(location,previous);
  // The renamed account owns the same pinned repository; the asset path must stay exact.
  const renamed=releaseAsset(from)&&from.startsWith('https://github.com/702165405/CXPalm/')&&
    next.href===from.replace('https://github.com/702165405/CXPalm/','https://github.com/retired7Coder/CXPalm/');
  if(!renamed&&!cdnAsset(next))throw new Error('更新跳转不属于此仓库的 GitHub 下载服务。');
  return next.href;
}
function cdnAsset(url){
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&
    ['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)&&
    /^\/github-production-release-asset(?:-2e65be)?\/1433754725\/[A-Za-z0-9-]+$/.test(url.pathname);
}
function nodeResponse(url,signal){
  return new Promise((resolve,reject)=>{
    // A one-shot connection avoids pooled-response confusion; no credentials or decompression.
    const req=https.get(url,{signal,agent:false,headers:{Accept:'application/json, application/octet-stream','Accept-Encoding':'identity',Connection:'close','User-Agent':'CXPalm-Desktop-Updater'}},response=>{
      resolve(response);
    });
    req.setTimeout(15000,()=>req.destroy(new Error('更新请求超时，请检查网络。')));
    req.on('error',error=>reject(new Error(error.name==='AbortError'?'更新操作已取消。':'无法连接固定 HTTPS 更新源，请检查网络或稍后重试。')));
  });
}
async function electronResponse(url,signal,net=require('electron').net){
  // Chromium respects the user's existing OS proxy; updater traffic has no login cookies.
  // Electron fetch cancels manual redirects instead of exposing 3xx responses.
  // HEAD exposes each hop for the shared allowlist before a body is downloaded.
  if(url!==FEED){
    const redirect=await new Promise((resolve,reject)=>{
      const req=net.request({url,method:'HEAD',redirect:'manual',credentials:'omit',useSessionCookies:false});
      const abort=()=>{req.abort();reject(new Error('更新操作已取消。'));};
      const timeout=setTimeout(()=>{req.abort();reject(new Error('更新请求超时。'));},15000);
      req.on('close',()=>{clearTimeout(timeout);signal.removeEventListener('abort',abort);});
      req.on('error',reject);
      req.on('redirect',(status,_method,location)=>{const stream=Readable.from([]);stream.statusCode=status;stream.headers={location};resolve(stream);req.abort();});
      req.on('response',response=>{if(response.statusCode===200)resolve(null);else{const stream=Readable.from([]);stream.statusCode=response.statusCode;stream.headers=response.headers;resolve(stream);}req.abort();});
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});req.end();
    });
    if(redirect)return redirect;
  }
  const response=await net.fetch(url,{signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json, application/octet-stream','Accept-Encoding':'identity'}});
  const stream=response.body?Readable.fromWeb(response.body):Readable.from([]);
  stream.statusCode=response.status;stream.headers=Object.fromEntries(response.headers.entries());
  return stream;
}
async function request(url,signal,fetchResponse=process.versions.electron?electronResponse:nodeResponse){
  if(url!==FEED&&!releaseAsset(url))throw new Error('更新请求不在固定仓库范围内。');
  const download=url!==FEED;
  for(let hop=0;hop<=3;hop++){
    const response=await fetchResponse(url,signal);
    if([301,302,303,307,308].includes(response.statusCode)){
      try{if(!download||hop===3)throw new Error('更新重定向次数或来源不受信任。');url=redirectURL(url,response.headers.location);}
      finally{response.destroy();}
      continue;
    }
    if(response.statusCode!==200){response.destroy();throw new Error(response.statusCode===404?'桌面更新源尚未发布（HTTP 404），请稍后重试。':`更新服务器返回 HTTP ${response.statusCode}。`);}
    if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new Error('更新服务器返回了不支持的压缩内容。');}
    return response;
  }
}
class DesktopUpdater extends EventEmitter{
  constructor({version,releaseLine=null,cacheDir,platform=process.platform,arch=process.arch,packaged=true,fetch=request}){
    super();this.releaseLine=releaseLine;versionParts(version);this.cacheDir=path.resolve(cacheDir);this.fetch=fetch;this.active=null;this.release=null;this.file=null;this.lastAuto=0;
    this.autoFile=path.join(this.cacheDir,'last-check.json');
    try{const at=readJSON(this.autoFile).value.at;if(Number.isFinite(at)&&at>0&&at<=Date.now())this.lastAuto=at;}catch{}
    const supported=platform==='win32'&&arch==='x64'&&packaged;
    this.state={phase:supported?'idle':'unsupported',currentVersion:version,supported,release:null,received:0,percent:0,lastChecked:null,message:supported?'尚未检查更新。':'当前只支持 Windows x64 正式打包版的在线安装更新。'};
  }
  status(){return {...this.state,release:this.release?{version:this.release.version,size:this.release.size,notes:this.release.notes}:null};}
  set(patch){Object.assign(this.state,patch);this.emit('changed',this.status());return this.status();}
  available(){if(!this.state.supported)throw new Error(this.state.message);if(this.active||this.state.phase==='installing')throw new Error('更新操作正在进行，请稍候。');}
  async check(automatic=false){
    if(automatic&&(!this.state.supported||this.active||['ready','installing'].includes(this.state.phase)||Date.now()-this.lastAuto<6*60*60*1000))return this.status();
    this.available();this.lastAuto=Date.now();
    try{atomicJSON(this.autoFile,{at:this.lastAuto});}catch{}
    const controller=new AbortController();this.active=controller;
    const timeout=setTimeout(()=>controller.abort(),20000);let response;
    this.set({phase:'checking',message:'正在检查桌面应用更新…'});
    try{
      response=await this.fetch(FEED,controller.signal);const chunks=[];let size=0;
      for await(const chunk of response){size+=chunk.length;if(size>65536)throw new Error('更新清单超过大小限制。');chunks.push(chunk);}
      let raw;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('无法读取桌面更新清单。');}
      const release=validateManifest(raw);this.file=null;
      if(this.releaseLine&&release.releaseLine!==this.releaseLine)throw new Error('更新源尚未切换到新的 0.0.x 发布系列，不会安装旧版本。');
      this.release=newer(release.version,this.state.currentVersion)?release:null;
      return this.set({phase:this.release?'available':'current',received:0,percent:0,lastChecked:new Date().toISOString(),message:this.release?'发现桌面新版本，点击下载后才会获取安装包。':'当前已是发布源中的最新版本。'});
    }catch(error){this.release=null;this.file=null;return this.set({phase:'error',message:error.message||'检查更新失败，请稍后重试。'});}
    finally{clearTimeout(timeout);response?.destroy();this.active=null;}
  }
  async download(){
    this.available();if(!this.release)throw new Error('请先检查并选择可用更新。');
    const release=this.release,controller=new AbortController();this.active=controller;
    const timeout=setTimeout(()=>controller.abort(),10*60*1000);let response,temporary,created=false;
    this.file=null;this.set({phase:'downloading',received:0,percent:0,message:'正在下载安装包；不会自动安装。'});
    try{
      fs.mkdirSync(this.cacheDir,{recursive:true,mode:0o700});
      // Only updater-owned flat cache files are removed, never user config/data.
      for(const name of fs.readdirSync(this.cacheDir))if(/^CXPalm-\d+\.\d+\.\d+-[a-f0-9-]{36}\.(part|exe)$/.test(name))this.remove(path.join(this.cacheDir,name));
      temporary=path.join(this.cacheDir,`CXPalm-${release.version}-${randomUUID()}.part`);
      response=await this.fetch(release.url,controller.signal);
      const declared=response.headers?.['content-length'];if(declared!==undefined&&Number(declared)!==release.size)throw new Error('安装包声明大小与更新清单不一致。');
      let received=0,lastProgress=0;const hash=createHash('sha256'),output=fs.createWriteStream(temporary,{flags:'wx',mode:0o600});output.once('open',()=>{created=true;});
      const measure=new Transform({transform:(chunk,_encoding,callback)=>{
        received+=chunk.length;if(received>release.size){callback(new Error('安装包超过清单大小，下载已拒绝。'));return;}
        hash.update(chunk);if(Date.now()-lastProgress>150){lastProgress=Date.now();this.set({received,percent:Math.floor(received/release.size*100)});}callback(null,chunk);
      }});
      await pipeline(response,measure,output,{signal:controller.signal});
      if(received!==release.size||hash.digest('hex')!==release.sha256)throw new Error('安装包大小或 SHA-256 校验失败，文件已拒绝。');
      const file=temporary.replace(/\.part$/,'.exe');fs.renameSync(temporary,file);created=false;this.file=file;
      return this.set({phase:'ready',received,percent:100,message:'下载完成，大小和 SHA-256 已校验。等待你确认安装。'});
    }catch(error){return this.set({phase:controller.signal.aborted?'available':'error',received:0,percent:0,message:controller.signal.aborted?'下载已取消或超时，可重新下载。':error.message||'下载失败，请稍后重试。'});}
    finally{
      clearTimeout(timeout);response?.destroy();
      try{if(created)this.remove(temporary);}finally{this.active=null;}
    }
  }
  cancel(){if(this.state.phase==='downloading')this.active?.abort();return this.status();}
  remove(file){if(path.dirname(path.resolve(file))!==this.cacheDir)throw new Error('更新缓存路径无效。');try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
  async installer(){
    this.available();if(this.state.phase!=='ready'||!this.file||!this.release)throw new Error('尚无已校验的安装包，请先下载更新。');
    const file=this.file,release=this.release;
    try{
      if(path.dirname(path.resolve(file))!==this.cacheDir)throw new Error('更新缓存路径无效。');
      const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==release.size)throw new Error('安装包已变化，请重新下载。');
      const hash=createHash('sha256');let size=0;
      for await(const chunk of fs.createReadStream(file)){size+=chunk.length;if(size>release.size)throw new Error('安装包已变化，请重新下载。');hash.update(chunk);}
      if(size!==release.size||hash.digest('hex')!==release.sha256)throw new Error('安装前校验失败，请重新下载。');return file;
    }catch(error){this.file=null;this.set({phase:'error',message:'安装包无法通过安装前校验，请重新下载。'});throw new Error(this.state.message);}
  }
  dispose(){this.active?.abort();}
}
module.exports={DesktopUpdater,FEED,RELEASES,MAX_SIZE,newer,validateManifest,request,redirectURL,electronResponse};
