const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app-20261025-v48.js','utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b)}
function context(extra={}){
  return vm.createContext({console,Date,Promise,Map,Set,Math,Number,Error,encodeURIComponent,setTimeout:fn=>setImmediate(fn),
    localStorage:{setItem(){},getItem(){return null}},say(){},render(){},saveCache(){},
    status:{textContent:''},msgs:[],self:'',lastSyncAt:0,SYNC_COOLDOWN:65000,BUILD:'test',
    settings:{days:730,max:1000},syncInProgress:false,rateLimitedUntil:0,simple:x=>x,...extra});
}
const syncCode=section('async function sync(', '// Update only the list:');
test('automatic sync is quiet, retains editor, and shares the manual/empty-mailbox cooldown',async()=>{
  let calls=0,refreshes=0,toasts=0;
  const c=context({isAutoSyncVisible:()=>true,canAutoSync:()=>true,
    refreshSyncedList:()=>refreshes++,say:()=>toasts++,render:()=>{throw Error('editor replaced')},
    api:async(path,opt)=>{calls++;assert.equal(opt.interactive,false);return path==='/profile'?{emailAddress:'a@b.com'}:{messages:[]}}
  });
  vm.runInContext(syncCode,c);
  await Promise.all([c.sync(false,{automatic:true}),c.sync(false,{automatic:true})]);
  assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(toasts,0);
  await c.sync(true);assert.equal(calls,2);
  c.lastSyncAt=0;c.api=async()=>{calls++;throw Error('offline')};
  toasts=0;await c.sync(false,{automatic:true});await c.sync(false,{automatic:true});
  assert.equal(calls,3);assert.equal(toasts,0);assert.equal(c.syncInProgress,false);
  c.lastSyncAt=0;c.api=async path=>path==='/profile'?{emailAddress:'a@b.com'}:{messages:[]};
  await c.sync(false,{automatic:true});assert.equal(refreshes,2);
});
test('automatic new mail updates list and status without a toast or editor replacement',async()=>{
  let refreshed=0;
  const c=context({isAutoSyncVisible:()=>true,canAutoSync:()=>true,
    refreshSyncedList:()=>refreshed++,say:()=>assert.fail('automatic toast'),render:()=>assert.fail('editor replaced'),
    api:async path=>path==='/profile'?{emailAddress:'a@b.com'}:path.startsWith('/messages?')?{messages:[{id:'new'}]}:{id:'new',at:2}
  });
  vm.runInContext(syncCode,c);await c.sync(false,{automatic:true});
  assert.equal(refreshed,1);assert.equal(c.msgs[0].id,'new');assert.match(c.status.textContent,/新着 1通/);
});
test('leaving foreground stops the next detail batch and preserves cache',async()=>{
  let visible=true,calls=0;
  const c=context({isAutoSyncVisible:()=>visible,canAutoSync:()=>true,msgs:[{id:'old'}],
    api:async path=>{
      calls++;
      if(path==='/profile')return {emailAddress:'a@b.com'};
      visible=false;return {messages:[{id:'new'}]};
    }
  });
  vm.runInContext(syncCode,c);await c.sync(false,{automatic:true});
  assert.equal(calls,2);assert.equal(c.msgs[0].id,'old');assert.equal(c.syncInProgress,false);
});
test('startup/resume debounce; one 5-minute timer; native pause and hidden visibility stop it',()=>{
  const intervals=new Map(),timeouts=new Map(),listeners={};let id=0,calls=0;
  const c=context({window:{addEventListener:(event,fn)=>listeners[event]=fn},
    document:{visibilityState:'visible',addEventListener:(event,fn)=>listeners[event]=fn},navigator:{onLine:true},
    setInterval:(fn,ms)=>{assert.equal(ms,300000);intervals.set(++id,fn);return id},clearInterval:id=>intervals.delete(id),
    setTimeout:(fn,ms)=>{assert.equal(ms,800);timeouts.set(++id,fn);return id},clearTimeout:id=>timeouts.delete(id),
    sync:(force,opt)=>{assert.equal(force,false);assert.equal(opt.automatic,true);calls++}
  });
  vm.runInContext(section('const AUTO_SYNC_MS=', 'function groups()'),c);
  c.resumeAutoSync();c.window.__mailTalkOnResume();listeners.visibilitychange();
  assert.equal(intervals.size,1);assert.equal(timeouts.size,1);
  [...timeouts.values()][0]();assert.equal(calls,1);timeouts.clear();
  [...intervals.values()][0]();assert.equal(calls,2);
  c.window.__mailTalkOnPause();assert.equal(intervals.size,0);assert.equal(timeouts.size,0);
  listeners.visibilitychange();assert.equal(intervals.size,0);
  c.window.__mailTalkOnResume();assert.equal(intervals.size,1);
  c.document.visibilityState='hidden';listeners.visibilitychange();assert.equal(intervals.size,0);assert.equal(timeouts.size,0);
});
test('automatic authentication eligibility excludes unconfigured, offline and expired browser sessions',()=>{
  const c=context({window:{addEventListener(){}},document:{visibilityState:'visible',addEventListener(){}},navigator:{onLine:true},token:'',expires:0});
  vm.runInContext(section('const AUTO_SYNC_MS=', 'function groups()'),c);
  assert.equal(c.canAutoSync(),false);
  c.window.MailTalkAndroid={authorizeSilently(){}};assert.equal(c.canAutoSync(),false);
  c.localStorage.getItem=()=> '1';assert.equal(c.canAutoSync(),true);
  c.navigator.onLine=false;assert.equal(c.canAutoSync(),false);
  c.navigator.onLine=true;delete c.window.MailTalkAndroid;
  c.settings.clientId='web';c.token='token';c.expires=Date.now()+10000;assert.equal(c.canAutoSync(),true);
  c.expires=0;assert.equal(c.canAutoSync(),false);
});
test('automatic native authorization uses silent bridge and browser never opens OAuth automatically',async()=>{
  let silent=0,interactive=0;
  const c=context({READ:'read',window:{MailTalkAndroid:{authorize(){interactive++},authorizeSilently(scope,id){silent++;c.window.__mailTalkNativeAuthResolve(id,'token',Date.now()+10000)}}}});
  vm.runInContext(section('let nativeAuthSeq=', 'async function auth('),c);
  await c.getToken('read',false);assert.equal(silent,1);assert.equal(interactive,0);
  delete c.window.MailTalkAndroid;await assert.rejects(c.getToken('read',false),/再接続/);
});
test('1000 messages paginate in 500s; detail concurrency <=10; second sync reuses cache',async()=>{
  let concurrent=0,peak=0,detailCount=0;const lists=[];
  const c=context({api:async path=>{
    if(path==='/profile')return {emailAddress:'TEST@example.com'};
    if(path.startsWith('/messages?')){
      lists.push(path);const offset=path.includes('pageToken=')?500:0;
      return {messages:Array.from({length:500},(_,i)=>({id:String(offset+i)})),nextPageToken:offset?'':'second page'};
    }
    concurrent++;peak=Math.max(peak,concurrent);detailCount++;
    await new Promise(r=>setImmediate(r));concurrent--;
    return {id:path.split('/')[2].split('?')[0],at:1};
  }});
  vm.runInContext(syncCode,c);
  await Promise.all([c.sync(),c.sync()]);
  assert.equal(c.msgs.length,1000);assert.equal(detailCount,1000);assert.equal(peak,10);
  assert.equal(lists.length,2);assert(lists[0].includes('newer_than%3A730d'));assert(lists[1].includes('pageToken=second%20page'));
  c.lastSyncAt=0;
  await c.sync(true);assert.equal(detailCount,1000);assert.equal(lists.length,4);
});
test('batch failure waits for outstanding requests and preserves cached mail',async()=>{
  let running=0;
  const c=context({msgs:[{id:'old',at:1}],api:async path=>{
    if(path==='/profile')return {emailAddress:'test@example.com'};
    if(path.startsWith('/messages?'))return {messages:Array.from({length:20},(_,i)=>({id:String(i)}))};
    if(path.includes('/0?'))throw Error('Gmail API rateLimitExceeded');
    running++;await new Promise(r=>setImmediate(r));running--;return {id:path,at:2};
  }});
  vm.runInContext(syncCode,c);await c.sync();
  assert.equal(running,0);assert.equal(c.syncInProgress,false);assert.equal(c.msgs[0].id,'old');
});
test('repeated page token terminates without partial replacement',async()=>{
  let pages=0;const c=context({api:async path=>path==='/profile'?{emailAddress:'a@b.com'}:(pages++,{messages:[{id:'a'}],nextPageToken:'same'})});
  vm.runInContext(syncCode,c);await c.sync();assert.equal(pages,2);assert.equal(c.msgs.length,0);
});
const apiCode=section('async function auth(', 'function peer(');
test('concurrent 401s share one authorization refresh and retry only once',async()=>{
  let requests=0,grants=0;
  const c=context({READ:'read',API:'https://example.test',token:'old',expires:Date.now()+10000,authPending:null,
    getToken:async()=>{grants++;await new Promise(r=>setImmediate(r));c.token='new';c.expires=Date.now()+10000},
    fetch:async(url,opt)=>{requests++;return opt.headers.Authorization==='Bearer old'?{status:401}:{ok:true,status:200,json:async()=>({ok:true})}}
  });
  vm.runInContext(apiCode,c);await Promise.all(Array.from({length:10},()=>c.api('/messages')));
  assert.equal(grants,1);assert.equal(requests,20);
  c.fetch=async()=>({status:401,ok:false,json:async()=>({})});
  await assert.rejects(c.api('/messages'),/401/);
});
test('429 blocks subsequent requests, honoring Retry-After',async()=>{
  let requests=0;const c=context({READ:'read',API:'',token:'valid',expires:Date.now()+10000,authPending:null,
    fetch:async()=>{requests++;return {ok:false,status:429,headers:{get:()=> '120'},json:async()=>({error:{message:'Quota exceeded'}})}}});
  vm.runInContext(apiCode,c);await assert.rejects(c.api('/messages'),/rateLimitExceeded/);
  assert(c.rateLimitedUntil>Date.now()+110000);
  await assert.rejects(c.api('/messages'),/rateLimitExceeded/);assert.equal(requests,1);
});
test('Android back: attachment -> chat -> list -> clear filters -> background',()=>{
  let viewer=true,closed=0,nav=0;
  const c=context({window:{},active:'person',replyId:'mail',tab:'talks',filter:'star',query:'find',
    app:{classList:{contains:()=>false,remove(){}}},clearComposeFiles(){},renderFilters(){},renderList(){},showEmpty(){},
    history:{replaceState(){}},location:{href:'https://example.test'},
    closeAttachmentViewer(){viewer=false;closed++},
    $:s=>s==='.attachment-viewer'?(viewer?{}:null):{value:'find'},
    $$:()=>[{dataset:{tab:'talks'},classList:{toggle(){nav++}}}]
  });
  vm.runInContext(section('window.__mailTalkHandleAndroidBack=',"window.addEventListener('popstate'"),c);
  const back=c.window.__mailTalkHandleAndroidBack;
  assert.equal(back(),true);assert.equal(closed,1);assert.equal(c.active,'person');
  assert.equal(back(),true);assert.equal(c.active,'');assert.equal(nav,1);
  assert.equal(back(),true);assert.equal(c.filter,'all');assert.equal(c.query,'');
  assert.equal(back(),false);
  for(const tab of ['settings','compose']){c.tab=tab;assert.equal(back(),true);assert.equal(c.tab,'talks')}
});
test('reply fits a short keyboard viewport and scrolls only for long content',()=>{
  const c=context({window:{visualViewport:{height:300}}});vm.runInContext(section('function autoGrowReplyTextarea(', 'function showChat('),c);
  const ta={style:{},scrollHeight:400};c.autoGrowReplyTextarea(ta);
  assert.equal(ta.style.height,'138px');assert.equal(ta.style.overflowY,'auto');
  ta.scrollHeight=90;c.autoGrowReplyTextarea(ta);assert.equal(ta.style.overflowY,'hidden');
});
test('same correspondent groups incoming and outgoing subjects chronologically',()=>{
  const c=context({autoCategory:()=> 'other',categoryById:()=>({name:'その他'}),msgs:[
    {id:'b',peerEmail:'a@b.com',peerName:'A',at:2,subject:'Different',dir:'out',labels:[]},
    {id:'a',peerEmail:'a@b.com',peerName:'A',at:1,subject:'First',dir:'in',labels:[]}
  ]});
  vm.runInContext(section('function groups()', 'function time('),c);
  const groups=c.groups();assert.equal(groups.length,1);assert.equal(groups[0].items[0].id,'a');
});
test('Japanese MIME subject, reply headers and original JWW filename survive encoding',async()=>{
  const c=context({TextEncoder,btoa,wrap76:s=>s,fileBase64:async()=> 'YWJj'});
  vm.runInContext(section('function mimeHeader(', 'const hdr='),c);
  vm.runInContext(section('function cleanHeaderValue(', 'function getComposePreviewUrl('),c);
  const mime=await c.buildMimeMessage({to:'a@b.com',subject:'図面確認',text:'',
    reply:{messageId:'<reply@example.com>',refs:'<root@example.com>'},
    files:[{name:'図面.jww',type:'application/octet-stream'}]});
  assert(mime.includes('Subject: =?UTF-8?B?'+Buffer.from('図面確認').toString('base64')+'?='));
  assert(mime.includes('In-Reply-To: <reply@example.com>'));
  assert(mime.includes('References: <root@example.com> <reply@example.com>'));
  assert(mime.includes("filename*=UTF-8''"+encodeURIComponent('図面.jww')));
});
test('new-compose text draft survives leaving and reopening the editor',()=>{
  const saved=new Map();const fields={};
  const c=context({tab:'talks',active:'',replyId:'',main:{innerHTML:''},app:{classList:{add(){}}},clearComposeFiles(){},
    setTimeout(){},sendNewMessage(){},
    localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},
    $:id=>fields[id]||(fields[id]={value:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn}})});
  vm.runInContext(section('function showNewCompose()', 'async function cacheSentComposeAttachments('),c);
  c.showNewCompose();fields['#newBodyDirect'].value='下書き本文';fields['#newBodyDirect'].listeners.input();
  fields['#newBodyDirect'].value='';c.showNewCompose();assert.equal(fields['#newBodyDirect'].value,'下書き本文');
});
