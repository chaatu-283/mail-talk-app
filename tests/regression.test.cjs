const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app-20261025-v48.js','utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b)}
function context(extra={}){
  return vm.createContext({console,Date,Promise,Map,Set,Math,Number,Error,encodeURIComponent,
    localStorage:{setItem(){},getItem(){return null}},say(){},render(){},saveCache(){},
    status:{textContent:''},msgs:[],self:'',lastSyncAt:0,SYNC_COOLDOWN:65000,BUILD:'test',
    settings:{days:730,max:1000},syncInProgress:false,rateLimitedUntil:0,simple:x=>x,...extra});
}
const syncCode=section('async function sync(', 'function groups()');
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
