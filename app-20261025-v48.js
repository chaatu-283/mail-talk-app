
const BUILD='v0.47-20261025';
const API='https://gmail.googleapis.com/gmail/v1/users/me';
const READ='https://www.googleapis.com/auth/gmail.readonly';
const SEND='https://www.googleapis.com/auth/gmail.send';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emailRe=/[A-Za-z0-9.!#$%&'*+\/=?^_{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const emails=s=>(String(s||'').match(emailRe)||[]).map(x=>x.toLowerCase());
const addr=s=>{const e=emails(s)[0]||'';const n=String(s||'').replace(/<[^>]+>/g,'').replace(e,'').replace(/["']/g,'').trim();return {email:e,name:n||e.split('@')[0]||'不明'}};

function avatarColorIndex(key){
  const s=String(key||'?').toLowerCase();
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}
  h^=h>>>16;h=Math.imul(h,0x45d9f3b);h^=h>>>16;h=Math.imul(h,0x45d9f3b);h^=h>>>16;
  return (h>>>0)%16;
}
let avatarAssignments=JSON.parse(localStorage.getItem('mt-avatar-colors')||'{}');
function avatarInitial(name,email){
  const s=String(name||email||'?').trim();
  return (Array.from(s)[0]||'?').toLocaleLowerCase();
}
function ensureAvatarAssignments(){
  const contacts=new Map();
  for(const m of msgs){
    if(!m.peerEmail)continue;
    const email=String(m.peerEmail).toLowerCase();
    contacts.set(email,{email,name:m.peerName||email});
  }
  const buckets=new Map();
  for(const c of contacts.values()){
    const k=avatarInitial(c.name,c.email);
    if(!buckets.has(k))buckets.set(k,[]);
    buckets.get(k).push(c);
  }
  let changed=false;
  for(const arr of buckets.values()){
    arr.sort((a,b)=>a.email.localeCompare(b.email));
    const used=new Set(),pending=[];
    for(const c of arr){
      const saved=Number(avatarAssignments[c.email]);
      if(Number.isInteger(saved)&&saved>=0&&saved<24&&!used.has(saved))used.add(saved);
      else pending.push(c);
    }
    for(const c of pending){
      let idx=avatarColorIndex(c.email),tries=0;
      while(used.has(idx)&&tries<24){idx=(idx+7)%24;tries++}
      if(used.has(idx)){
        for(let n=0;n<24;n++){if(!used.has(n)){idx=n;break}}
      }
      if(avatarAssignments[c.email]!==idx){avatarAssignments[c.email]=idx;changed=true}
      used.add(idx);
    }
  }
  if(changed)localStorage.setItem('mt-avatar-colors',JSON.stringify(avatarAssignments));
}
function avatarClass(key){
  ensureAvatarAssignments();
  const email=String(key||'').toLowerCase();
  const idx=Number(avatarAssignments[email]);
  return 'avatar-color-'+(Number.isInteger(idx)?idx:avatarColorIndex(email));
}
const dec=s=>{if(!s)return'';s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new TextDecoder().decode(b)};
function b64bytes(s){if(!s)return new Uint8Array();s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
const enc=s=>{const b=new TextEncoder().encode(s);let x='';for(let i=0;i<b.length;i+=0x8000)x+=String.fromCharCode(...b.slice(i,i+0x8000));return btoa(x).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
function mimeHeader(s){s=String(s||'');if(/^[\x20-\x7E]*$/.test(s))return s;const b=new TextEncoder().encode(s);let x='';for(let i=0;i<b.length;i+=0x8000)x+=String.fromCharCode(...b.slice(i,i+0x8000));return '=?UTF-8?B?'+btoa(x)+'?='}
const hdr=(m,n)=>(m.payload?.headers||[]).find(x=>x.name.toLowerCase()===n.toLowerCase())?.value||'';
const htmlText=h=>{const d=new DOMParser().parseFromString(String(h||''),'text/html');d.querySelectorAll('script,style').forEach(n=>n.remove());return (d.body?.innerText||'').replace(/\n{3,}/g,'\n\n').trim()};
function body(p){if(!p)return'';if(p.mimeType==='text/plain'&&p.body?.data)return dec(p.body.data);for(const x of p.parts||[]){const v=body(x);if(v)return v}if(p.mimeType==='text/html'&&p.body?.data)return htmlText(dec(p.body.data));return''}
function files(p,a=[]){if(p?.filename)a.push({name:p.filename,type:p.mimeType||'',size:p.body?.size||0,id:p.body?.attachmentId||''});for(const x of p?.parts||[])files(x,a);return a}
let token='', expires=0, self='', msgs=[], active='', query='', filter='all', tab='talks', replyId='', timer, composeFiles=[];
const composePreviewUrls=new Map();
const MAX_SEND_FILES=5, MAX_SEND_BYTES=10*1024*1024;
const CACHE_KEY='mt-mail-cache-v1', SYNC_COOLDOWN=65000;
let lastSyncAt=Number(localStorage.getItem('mt-last-sync')||0);
let settings={clientId:localStorage.getItem('mt-client')||'',days:Number(localStorage.getItem('mt-days')||30),max:Number(localStorage.getItem('mt-max')||80)};
let drafts=JSON.parse(localStorage.getItem('mt-drafts')||'{}');
let favorites=new Set(JSON.parse(localStorage.getItem('mt-favorites')||'[]'));
function saveFavorites(){localStorage.setItem('mt-favorites',JSON.stringify([...favorites]))}
function toggleFavorite(email){
  if(favorites.has(email))favorites.delete(email);else favorites.add(email);
  saveFavorites();renderFilters();renderList();
}
const DEFAULT_CATEGORIES=[
  {id:'work',name:'仕事',keywords:'株式会社,有限会社,設備,工事,現場,施工,工程,プロジェクト,打合せ,確認'},
  {id:'order',name:'注文・材料',keywords:'注文,発注,納品,材料,管材,継手,カフス,インクリーザー,プレハブ,数量,見積'},
  {id:'drawing',name:'図面',keywords:'図面,施工図,平面図,階段図,CAD,TFAS,TFS,JWW,DXF,DWG'},
  {id:'invoice',name:'請求書',keywords:'請求,請求書,支払,振込,入金,invoice,領収書'},
  {id:'personal',name:'個人',keywords:'個人,家族,友達,写真送ります,住所'},
  {id:'ads',name:'広告',keywords:'広告,キャンペーン,セール,クーポン,配信停止,unsubscribe,newsletter,promotion,promo,メルマガ'},
  {id:'other',name:'その他',keywords:''}
];
function loadCategories(){
  try{
    const v=JSON.parse(localStorage.getItem('mt-categories')||'null');
    if(Array.isArray(v)&&v.length)return v;
  }catch(_){}
  return DEFAULT_CATEGORIES.map(x=>({...x}));
}
let categories=loadCategories();
let categoryOverrides=JSON.parse(localStorage.getItem('mt-category-overrides')||'{}');
let appearance=JSON.parse(localStorage.getItem('mt-appearance')||'null')||{theme:'line',font:'system',size:'normal',accent:'#1a73e8'};
function saveCategories(){localStorage.setItem('mt-categories',JSON.stringify(categories))}
function saveCategoryOverrides(){localStorage.setItem('mt-category-overrides',JSON.stringify(categoryOverrides))}
function categoryById(id){return categories.find(c=>c.id===id)}
function splitKeywords(s){return String(s||'').split(/[、,\n]+/).map(x=>x.trim().toLowerCase()).filter(Boolean)}
function autoCategory(g){
  const manual=categoryOverrides[g.email];
  if(manual&&categoryById(manual))return manual;
  const allText=[g.email,g.name,...g.items.flatMap(x=>[x.subject,x.body,...(x.attachments||[]).map(a=>a.name)])].join('\n').toLowerCase();
  if(g.items.some(x=>(x.labels||[]).includes('CATEGORY_PROMOTIONS'))&&categoryById('ads'))return 'ads';
  let best='',score=0;
  for(const c of categories){
    if(c.id==='other')continue;
    let s=0;
    for(const kw of splitKeywords(c.keywords)){
      if(allText.includes(kw))s+=Math.max(1,Math.min(4,Math.ceil(kw.length/2)));
    }
    if(c.id==='drawing'){
      for(const x of g.items)for(const a of (x.attachments||[]))if(/\.(tfs|jww|dxf|dwg)$/i.test(a.name||''))s+=6;
    }
    if(c.id==='invoice'){
      for(const x of g.items)for(const a of (x.attachments||[]))if(/請求|invoice|領収/i.test(a.name||''))s+=6;
    }
    if(s>score){score=s;best=c.id}
  }
  if(best&&score>0)return best;
  const domain=(g.email.split('@')[1]||'').toLowerCase();
  if(categoryById('personal')&&/^(gmail\.com|yahoo\.|icloud\.com|outlook\.com|hotmail\.)/.test(domain))return 'personal';
  if(categoryById('work')&&domain&&!/gmail\.com|yahoo\.|icloud\.com|outlook\.com|hotmail\./.test(domain))return 'work';
  return categoryById('other')?'other':(categories[0]?.id||'');
}
function applyAppearance(){
  const root=document.documentElement;
  root.dataset.theme=appearance.theme||'line';
  root.dataset.font=appearance.font||'system';
  root.dataset.size=appearance.size||'normal';
  root.style.setProperty('--accent',appearance.accent||'#1a73e8');
}
function saveAppearance(){
  localStorage.setItem('mt-appearance',JSON.stringify(appearance));
  applyAppearance();
}
const app=$('.app'), list=$('#talkList'), main=$('#mainPane'), status=$('#statusText'), toast=$('#toast');
const listBackBtn=$('#listBackBtn');
function updateListBack(){
  if(!listBackBtn)return;
  const on=(filter!=='all'||query.trim());
  listBackBtn.hidden=!on;
}
if(!history.state?.mt)history.replaceState({mt:'list'},'',location.href);
function saveCache(){
  try{
    const slim=msgs.map(m=>({...m,body:String(m.body||'').slice(0,20000)}));
    localStorage.setItem(CACHE_KEY,JSON.stringify({at:Date.now(),self,msgs:slim,clientId:settings.clientId}));
  }catch(_){}
}
function restoreCache(){
  try{
    const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    if(c?.clientId===settings.clientId&&Array.isArray(c.msgs)&&c.msgs.length){
      self=c.self||'';msgs=c.msgs;
      status.textContent=(self?self+' · ':'')+msgs.length+'通 · 保存データ · '+BUILD;
      return true;
    }
  }catch(_){}
  return false;
}
function say(t){clearTimeout(timer);toast.textContent=t;toast.classList.add('show');timer=setTimeout(()=>toast.classList.remove('show'),3000)}
const attachmentCache=new Map();
let attachmentView=null;
function attachmentKey(messageId,name){return messageId+'\n'+name}
function isImageFile(f){return /^image\//i.test(f?.type||'')||/\.(png|jpe?g|gif|webp|bmp)$/i.test(f?.name||'')}
function isPdfFile(f){return /pdf/i.test(f?.type||'')||/\.pdf$/i.test(f?.name||'')}
async function resolveAttachment(messageId,name){
  let m=msgs.find(x=>x.id===messageId),att=m?.attachments?.find(x=>x.name===name);
  if(att?.id)return {m,att};
  const full=await api('/messages/'+messageId+'?format=full');
  const fresh=simple(full);
  const i=msgs.findIndex(x=>x.id===messageId);
  if(i>=0)msgs[i]=fresh;else msgs.push(fresh);
  saveCache();
  m=fresh;att=fresh.attachments.find(x=>x.name===name);
  if(!att?.id)throw Error('添付ファイル本体を取得できませんでした。');
  return {m,att};
}
async function getAttachmentBlob(messageId,name){
  const key=attachmentKey(messageId,name);
  if(attachmentCache.has(key))return attachmentCache.get(key);
  const {att}=await resolveAttachment(messageId,name);
  const data=await api('/messages/'+messageId+'/attachments/'+encodeURIComponent(att.id));
  const blob=new Blob([b64bytes(data.data)],{type:att.type||'application/octet-stream'});
  const info={url:URL.createObjectURL(blob),blob,name:att.name,type:att.type||blob.type,size:att.size||blob.size,messageId};
  attachmentCache.set(key,info);
  return info;
}
function renderAttachments(m){
  if(!m.attachments?.length)return '';
  const photos=m.attachments.filter(isImageFile);
  const others=m.attachments.filter(f=>!isImageFile(f));
  let out='';
  if(photos.length){
    out+='<div class="photo-grid '+(photos.length===1?'one':'')+'">'+photos.map(f=>
      '<button type="button" class="photo-tile" data-att-open="1" data-msg-id="'+esc(m.id)+'" data-att-name="'+esc(f.name)+'" '+(f.previewData?'':'data-att-preview="1"')+'><span class="att-photo-thumb">'+(f.previewData?'<img src="'+f.previewData+'" alt="">':'🖼️')+'</span><span class="photo-name">'+esc(f.name)+'</span></button>'
    ).join('')+'</div>';
  }
  if(others.length){
    out+='<div class="attachments">'+others.map(f=>{
      const pdf=isPdfFile(f),icon=pdf?'📄':'📎';
      return '<button type="button" class="attachment" data-att-open="1" data-msg-id="'+esc(m.id)+'" data-att-name="'+esc(f.name)+'"><span class="att-icon">'+icon+'</span><span class="att-label"><strong>'+esc(f.name)+'</strong><small>'+(pdf?'PDF':esc((f.type||'ファイル').split('/').pop()))+'</small></span></button>';
    }).join('')+'</div>';
  }
  return out;
}
async function makeThumbDataUrl(blob,maxSide=320){
  try{
    const bmp=await createImageBitmap(blob);
    const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
    const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
    return c.toDataURL('image/jpeg',.68);
  }catch(_){return ''}
}
function saveAttachmentPreview(messageId,name,dataUrl){
  if(!dataUrl)return;
  const m=msgs.find(x=>x.id===messageId),a=m?.attachments?.find(x=>x.name===name);
  if(a){a.previewData=dataUrl;saveCache()}
}
async function loadAttachmentPreview(button){
  if(button.dataset.previewLoaded)return;
  button.dataset.previewLoaded='loading';
  try{
    const info=await getAttachmentBlob(button.dataset.msgId,button.dataset.attName);
    if(!/^image\//i.test(info.type)){button.dataset.previewLoaded='skip';return}
    const box=button.querySelector('.att-thumb,.att-photo-thumb');
    if(box)box.innerHTML='<img src="'+info.url+'" alt="">';
    const thumb=await makeThumbDataUrl(info.blob);
    if(thumb)saveAttachmentPreview(button.dataset.msgId,button.dataset.attName,thumb);
    button.dataset.previewLoaded='1';
  }catch(_){button.dataset.previewLoaded='error'}
}
function setupAttachmentPreviews(){
  const buttons=$('[data-att-preview]');
  if(!buttons.length||!token||Date.now()>=expires)return;
  if('IntersectionObserver'in window){
    const ob=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){ob.unobserve(e.target);loadAttachmentPreview(e.target)}}),{root:$('.msgs'),rootMargin:'120px'});
    buttons.forEach(b=>ob.observe(b));
  }else buttons.slice(0,4).forEach(loadAttachmentPreview);
}
function downloadAttachment(info){
  const a=document.createElement('a');
  a.href=info.url;
  a.download=info.name||'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function browserDisplayableAttachment(info){
  return /^image\//i.test(info?.type||'')||isPdfFile(info);
}
async function openExternalAttachment(info){
  if(!info)return;
  if(browserDisplayableAttachment(info)){
    window.open(info.url,'_blank','noopener');
    return;
  }
  const name=info.name||'attachment';
  try{
    const file=new File([info.blob],name,{type:info.type||'application/octet-stream'});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:name});
      return;
    }
  }catch(e){
    if(e?.name==='AbortError')return;
  }
  downloadAttachment(info);
  say('元のファイル名で保存しました。ダウンロード通知から開いてください。');
}
function closeAttachmentViewer(viaHistory=true){
  const v=$('.attachment-viewer');if(v)v.remove();attachmentView=null;
  if(viaHistory&&history.state?.mt==='attachment')history.back();
}
let pdfjsLibPromise=null;
async function loadPdfJs(){
  if(!pdfjsLibPromise){
    pdfjsLibPromise=import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs').then(lib=>{
      lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsLibPromise;
}
async function renderPdfPage(focus=null){
  const viewer=$('.attachment-viewer');
  const stage=viewer?.querySelector('.pdf-canvas-stage');
  const wrap=viewer?.querySelector('.pdf-canvas-wrap');
  const canvas=viewer?.querySelector('#pdfCanvas');
  const st=attachmentView?.pdf;
  if(!viewer||!stage||!wrap||!canvas||!st?.doc)return;
  const page=await st.doc.getPage(st.page);
  const base=page.getViewport({scale:1});
  const usable=Math.max(260,stage.clientWidth-24);
  const fit=usable/base.width;
  const scale=Math.max(.35,Math.min(6,fit*st.zoom));
  const prevScale=st.renderScale||scale;
  const focusDoc=focus?{x:stage.scrollLeft+focus.x,y:stage.scrollTop+focus.y}:null;
  const vp=page.getViewport({scale});
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.floor(vp.width*dpr);
  canvas.height=Math.floor(vp.height*dpr);
  canvas.style.width=vp.width+'px';
  canvas.style.height=vp.height+'px';
  const innerW=Math.max(1,stage.clientWidth-24);
  wrap.style.width=Math.max(vp.width,innerW)+'px';
  wrap.style.height=vp.height+'px';
  canvas.style.marginLeft=vp.width<innerW?((innerW-vp.width)/2)+'px':'0';
  canvas.style.marginRight='0';
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(st.task){try{st.task.cancel()}catch(_){}}
  st.task=page.render({canvasContext:ctx,viewport:vp});
  try{await st.task.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}
  st.renderScale=scale;
  if(focusDoc&&prevScale>0){
    const ratio=scale/prevScale;
    stage.scrollLeft=Math.max(0,focusDoc.x*ratio-focus.x);
    stage.scrollTop=Math.max(0,focusDoc.y*ratio-focus.y);
  }
  const lab=viewer.querySelector('#pdfPageLabel');
  if(lab){const maxX=Math.max(0,stage.scrollWidth-stage.clientWidth);lab.textContent=st.page+' / '+st.doc.numPages+' · '+Math.round(st.zoom*100)+'%'+(maxX>2?' ↔':'');}
  const prev=viewer.querySelector('[data-pdf-prev]'),next=viewer.querySelector('[data-pdf-next]');
  if(prev)prev.disabled=st.page<=1;
  if(next)next.disabled=st.page>=st.doc.numPages;
}
function setupPdfGestures(){
  const stage=$('.pdf-canvas-stage'),st=attachmentView?.pdf;
  if(!stage||!st||stage.dataset.gestures==='1')return;
  stage.dataset.gestures='1';
  const pts=new Map();
  let pan=null,pinch=null,lastTap=0,moved=false,renderTimer=null;
  const pos=e=>({x:e.clientX,y:e.clientY});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const focusFromClient=p=>{const r=stage.getBoundingClientRect();return {x:p.x-r.left,y:p.y-r.top}};
  const schedule=(focus)=>{
    clearTimeout(renderTimer);
    renderTimer=setTimeout(()=>renderPdfPage(focus),55);
  };
  stage.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch')return;
    try{stage.setPointerCapture(e.pointerId)}catch(_){}
    pts.set(e.pointerId,pos(e));moved=false;
    if(pts.size===1){
      pan={id:e.pointerId,last:pos(e)};
      pinch=null;
    }else if(pts.size===2){
      const [a,b]=[...pts.values()];
      pinch={startDist:Math.max(1,distance(a,b)),startZoom:st.zoom,center:midpoint(a,b)};
      pan=null;
    }
    e.preventDefault();
  },{passive:false});
  stage.addEventListener('pointermove',e=>{
    if(e.pointerType!=='touch'||!pts.has(e.pointerId))return;
    pts.set(e.pointerId,pos(e));
    if(pts.size===1&&pan&&pan.id===e.pointerId){
      const p=pos(e),dx=p.x-pan.last.x,dy=p.y-pan.last.y;
      if(Math.abs(dx)>1||Math.abs(dy)>1)moved=true;
      const maxX=Math.max(0,stage.scrollWidth-stage.clientWidth);
      const maxY=Math.max(0,stage.scrollHeight-stage.clientHeight);
      stage.scrollLeft=Math.max(0,Math.min(maxX,stage.scrollLeft-dx));
      stage.scrollTop=Math.max(0,Math.min(maxY,stage.scrollTop-dy));
      pan.last=p;
    }else if(pts.size===2){
      const [a,b]=[...pts.values()],d=distance(a,b),mid=midpoint(a,b);
      if(Math.abs(d-pinch.startDist)>4)moved=true;
      st.zoom=Math.max(.5,Math.min(8,pinch.startZoom*(d/pinch.startDist)));
      schedule(focusFromClient(mid));
    }
    e.preventDefault();
  },{passive:false});
  const end=e=>{
    if(e.pointerType!=='touch')return;
    const p=pos(e),wasSingle=pts.size===1;
    pts.delete(e.pointerId);
    if(pts.size===1){
      const [id,q]=[...pts.entries()][0];
      pan={id,last:q};
      pinch=null;
    }else if(!pts.size){
      pan=null;pinch=null;
      if(wasSingle&&!moved){
        const now=Date.now();
        if(now-lastTap<320){
          st.zoom=st.zoom>1.25?1:3;
          renderPdfPage(focusFromClient(p));
          lastTap=0;
        }else lastTap=now;
      }
    }
    e.preventDefault();
  };
  stage.addEventListener('pointerup',end,{passive:false});
  stage.addEventListener('pointercancel',end,{passive:false});
}
async function initPdfViewer(info){
  try{
    const lib=await loadPdfJs();
    const data=new Uint8Array(await info.blob.arrayBuffer());
    const doc=await lib.getDocument({data}).promise;
    if(!attachmentView||attachmentView.url!==info.url)return;
    attachmentView.pdf={doc,page:1,zoom:1,renderScale:null,task:null,resizeTimer:null};
    await renderPdfPage();
    setupPdfGestures();
  }catch(e){
    const stage=$('.pdf-canvas-stage');
    if(stage)stage.innerHTML='<div class="pdf-fallback"><strong>PDFをアプリ内で表示できませんでした。</strong><small>'+esc(e?.message||'')+'</small><p>下の「端末で開く」なら確認できます。</p></div>';
  }
}
function setImageTransform(){
  const viewer=$('.attachment-viewer');
  const stage=viewer?.querySelector('.image-stage');
  const img=viewer?.querySelector('.attachment-image');
  const st=attachmentView?.image;
  if(!viewer||!stage||!img||!st)return;
  img.style.transform='translate('+st.x+'px,'+st.y+'px) scale('+st.zoom+')';
  const lab=viewer.querySelector('#imageZoomLabel');
  if(lab)lab.textContent=Math.round(st.zoom*100)+'%';
}
function resetImageView(){
  const st=attachmentView?.image;if(!st)return;
  st.zoom=1;st.x=0;st.y=0;setImageTransform();
}
function setupImageGestures(){
  const viewer=$('.attachment-viewer'),stage=viewer?.querySelector('.image-stage'),img=viewer?.querySelector('.attachment-image');
  if(!viewer||!stage||!img||stage.dataset.gestures==='1')return;
  stage.dataset.gestures='1';
  const st=attachmentView.image={zoom:1,x:0,y:0};
  const pts=new Map();
  let pan=null,pinch=null,lastTap=0,moved=false;
  const pos=e=>({x:e.clientX,y:e.clientY});
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const local=p=>{const r=stage.getBoundingClientRect();return{x:p.x-r.left-r.width/2,y:p.y-r.top-r.height/2}};
  stage.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch')return;
    try{stage.setPointerCapture(e.pointerId)}catch(_){}
    pts.set(e.pointerId,pos(e));moved=false;
    if(pts.size===1){pan={id:e.pointerId,last:pos(e)};pinch=null}
    else if(pts.size===2){
      const [a,b]=[...pts.values()];
      pinch={startDist:Math.max(1,dist(a,b)),startZoom:st.zoom,startX:st.x,startY:st.y,center:local(mid(a,b))};
      pan=null;
    }
    e.preventDefault();
  },{passive:false});
  stage.addEventListener('pointermove',e=>{
    if(e.pointerType!=='touch'||!pts.has(e.pointerId))return;
    pts.set(e.pointerId,pos(e));
    if(pts.size===1&&pan&&pan.id===e.pointerId){
      const p=pos(e),dx=p.x-pan.last.x,dy=p.y-pan.last.y;
      if(Math.abs(dx)>1||Math.abs(dy)>1)moved=true;
      st.x+=dx;st.y+=dy;pan.last=p;setImageTransform();
    }else if(pts.size===2&&pinch){
      const [a,b]=[...pts.values()],d=dist(a,b),c=local(mid(a,b));
      const nz=Math.max(1,Math.min(8,pinch.startZoom*(d/pinch.startDist)));
      const ratio=nz/pinch.startZoom;
      st.zoom=nz;
      st.x=pinch.startX+(c.x-pinch.center.x)*1.2+(1-ratio)*pinch.center.x;
      st.y=pinch.startY+(c.y-pinch.center.y)*1.2+(1-ratio)*pinch.center.y;
      moved=true;setImageTransform();
    }
    e.preventDefault();
  },{passive:false});
  const end=e=>{
    if(e.pointerType!=='touch')return;
    const p=pos(e),single=pts.size===1;
    pts.delete(e.pointerId);
    if(pts.size===1){const [id,q]=[...pts.entries()][0];pan={id,last:q};pinch=null}
    else if(!pts.size){
      pan=null;pinch=null;
      if(single&&!moved){
        const now=Date.now();
        if(now-lastTap<320){
          if(st.zoom>1.2)resetImageView();
          else{st.zoom=3;st.x=0;st.y=0;setImageTransform()}
          lastTap=0;
        }else lastTap=now;
      }
    }
    e.preventDefault();
  };
  stage.addEventListener('pointerup',end,{passive:false});
  stage.addEventListener('pointercancel',end,{passive:false});
  img.addEventListener('load',resetImageView,{once:true});
  resetImageView();
}
function showAttachmentViewer(info){
  closeAttachmentViewer(false);
  if(history.state?.mt!=='attachment')history.pushState({mt:'attachment'},'',location.href);
  attachmentView=info;
  const v=document.createElement('div');v.className='attachment-viewer';
  const media=/^image\//i.test(info.type)?'<div class="attachment-stage image-stage"><img class="attachment-image" src="'+info.url+'" alt="'+esc(info.name)+'"><div class="image-tools"><button type="button" data-img-minus>−</button><button type="button" data-img-fit>全体</button><span id="imageZoomLabel">100%</span><button type="button" data-img-plus>＋</button></div></div>':isPdfFile(info)?'<div class="attachment-stage pdf-stage"><div class="pdf-canvas-stage"><div class="pdf-canvas-wrap"><canvas id="pdfCanvas"></canvas></div></div><div class="pdf-tools"><button type="button" data-pdf-prev>‹</button><span id="pdfPageLabel">読込中…</span><button type="button" data-pdf-next>›</button><button type="button" data-pdf-minus>−</button><button type="button" data-pdf-fit>全体</button><button type="button" data-pdf-plus>＋</button></div></div>':'<div class="attachment-stage attachment-generic"><div class="generic-icon">📎</div><strong>'+esc(info.name)+'</strong><p>この形式はブラウザ内では表示できません。下の「対応アプリへ渡す」で、元のファイル名・拡張子のまま開けます。</p></div>';
  v.innerHTML='<header class="attachment-head"><button type="button" class="attachment-back" data-att-close>‹</button><div><strong>'+esc(info.name)+'</strong><small>'+esc(info.type||'ファイル')+(info.compose?' · 送信前確認':'')+' · '+BUILD+'</small></div></header>'+media+'<footer class="attachment-actions">'+(info.compose?'<button type="button" class="secondary" data-att-close>戻る</button>':'<button type="button" class="secondary" data-att-download>保存</button>')+'<button type="button" class="primary" data-att-external>'+(browserDisplayableAttachment(info)?'端末で開く':'対応アプリへ渡す')+'</button></footer>';
  document.body.appendChild(v);
  if(isPdfFile(info))initPdfViewer(info);
  else if(/^image\//i.test(info.type))setupImageGestures();
}
async function openAttachment(messageId,name){
  try{say('添付を読み込んでいます…');const info=await getAttachmentBlob(messageId,name);showAttachmentViewer(info)}
  catch(e){say(e.message||'添付を開けませんでした。')}
}
function gis(){if(!window.google?.accounts?.oauth2){say('Google認証を読み込み中です。少し待ってください。');return false}if(!settings.clientId){showSettings();say('先にOAuth Client IDを登録してください。');return false}return true}
let nativeAuthSeq=0;
const nativeAuthPending=new Map();
window.__mailTalkNativeAuthResolve=(id,accessToken,expiresAt)=>{
  const p=nativeAuthPending.get(String(id));if(!p)return;
  nativeAuthPending.delete(String(id));
  token=String(accessToken||'');
  expires=Number(expiresAt||0)||Date.now()+50*60*1000;
  localStorage.setItem('mt-oauth-granted','1');
  if(token)p.res();else p.rej(Error('Google認証トークンを取得できませんでした'));
};
window.__mailTalkNativeAuthReject=(id,message)=>{
  const p=nativeAuthPending.get(String(id));if(!p)return;
  nativeAuthPending.delete(String(id));
  p.rej(Error(message||'Android側のGoogle認証に失敗しました'));
};
function nativeGetToken(scopes){
  return new Promise((res,rej)=>{
    const bridge=window.MailTalkAndroid;
    if(!bridge||typeof bridge.authorize!=='function')return rej(Error('Android認証ブリッジが利用できません'));
    const id=String(++nativeAuthSeq);
    nativeAuthPending.set(id,{res,rej});
    try{bridge.authorize(String(scopes||READ),id)}
    catch(e){nativeAuthPending.delete(id);rej(e)}
  });
}
function getToken(scopes){
  if(window.MailTalkAndroid&&typeof window.MailTalkAndroid.authorize==='function')return nativeGetToken(scopes);
  return new Promise((res,rej)=>{if(!gis())return rej(Error('OAuth設定が必要です'));const c=google.accounts.oauth2.initTokenClient({client_id:settings.clientId,scope:scopes,include_granted_scopes:true,callback:r=>{if(r.error)return rej(Error(r.error));token=r.access_token;expires=Date.now()+(Number(r.expires_in||3600)-60)*1000;localStorage.setItem('mt-oauth-granted','1');res()}});c.requestAccessToken({prompt:''})})
}
async function auth(scopes=READ){if(token&&Date.now()<expires)return;await getToken(scopes)}
async function api(path,opt={}){await auth(opt.scope||READ);let r=await fetch(API+path,{method:opt.method||'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:opt.body});if(r.status===401){token='';await auth(opt.scope||READ);return api(path,opt)}if(!r.ok){let d=null;try{d=await r.json()}catch(_){ }const msg=d?.error?.message||d?.error_description||'詳細不明';const reason=d?.error?.errors?.[0]?.reason||'';throw Error('Gmail API '+r.status+': '+msg+(reason?' ['+reason+']':''));}return r.status===204?null:r.json()}
function peer(m){const from=addr(hdr(m,'From')),to=emails(hdr(m,'To')),cc=emails(hdr(m,'Cc'));const out=from.email===self;const e=out?(to.find(x=>x!==self)||cc.find(x=>x!==self)||to[0]||''):from.email;let name=out?addr((hdr(m,'To').split(',').find(x=>emails(x).includes(e))||e)).name:from.name;return {email:e,name:name||e,dir:out?'out':'in'}}
function simple(m){const p=peer(m);return {id:m.id,threadId:m.threadId,labels:m.labelIds||[],at:Number(m.internalDate||Date.now()),from:hdr(m,'From'),to:hdr(m,'To'),cc:hdr(m,'Cc'),replyTo:hdr(m,'Reply-To'),subject:hdr(m,'Subject')||'（件名なし）',messageId:hdr(m,'Message-ID'),refs:hdr(m,'References'),inReplyTo:hdr(m,'In-Reply-To'),body:body(m.payload)||m.snippet||'',attachments:files(m.payload),peerEmail:p.email,peerName:p.name,dir:p.dir}}
async function sync(force=false){
  const now=Date.now();
  if(!force&&msgs.length&&now-lastSyncAt<SYNC_COOLDOWN){
    const sec=Math.max(1,Math.ceil((SYNC_COOLDOWN-(now-lastSyncAt))/1000));
    status.textContent=(self?self+' · ':'')+msgs.length+'通 · 次の同期まで約'+sec+'秒';
    say('Gmailの制限を避けるため、約'+sec+'秒後に同期できます。');
    render();
    return;
  }
  try{
    status.textContent='同期中…';
    const prof=await api('/profile');
    self=prof.emailAddress.toLowerCase();
    const q='newer_than:'+Math.max(1,settings.days)+'d';
    const ids=[];
    let pageToken='';
    while(ids.length<settings.max){
      const pageSize=Math.min(500,settings.max-ids.length);
      const path='/messages?maxResults='+pageSize+'&q='+encodeURIComponent(q)+(pageToken?'&pageToken='+encodeURIComponent(pageToken):'');
      const l=await api(path);
      ids.push(...(l.messages||[]).map(x=>x.id));
      pageToken=l.nextPageToken||'';
      status.textContent='メール一覧を確認中 '+ids.length+'/'+settings.max;
      if(!pageToken||(l.messages||[]).length===0)break;
    }
    const existing=new Map(msgs.map(x=>[x.id,x]));
    const kept=ids.filter(id=>existing.has(id)).map(id=>existing.get(id));
    const missing=ids.filter(id=>!existing.has(id));
    const fresh=[];
    for(let i=0;i<missing.length;i+=10){
      const batch=missing.slice(i,i+10);
      const got=await Promise.all(batch.map(id=>api('/messages/'+id+'?format=full')));
      fresh.push(...got.map(simple));
      status.textContent='新着を読み込み中 '+Math.min(i+10,missing.length)+'/'+missing.length;
    }
    msgs=[...kept,...fresh].sort((a,b)=>a.at-b.at);
    lastSyncAt=Date.now();
    localStorage.setItem('mt-last-sync',String(lastSyncAt));
    saveCache();
    status.textContent=self+' · '+msgs.length+'通 · '+BUILD;
    render();
    say(missing.length?'新着 '+missing.length+'通を同期しました':'新着はありません');
  }catch(e){
    if(/rateLimitExceeded|Quota exceeded/i.test(e.message)){
      lastSyncAt=Date.now();
      localStorage.setItem('mt-last-sync',String(lastSyncAt));
      status.textContent=(self?self+' · ':'')+(msgs.length?msgs.length+'通 · ':'')+'Gmail一時制限中';
      if(msgs.length)render();
      say('Gmailの一時制限です。約1分待ってから同期してください。');
    }else{
      status.textContent='接続エラー';
      say(e.message);
    }
  }
}
function groups(){
  const m=new Map();
  for(const x of msgs){
    if(!x.peerEmail)continue;
    let g=m.get(x.peerEmail);
    if(!g)g={email:x.peerEmail,name:x.peerName,items:[]};
    g.items.push(x);if(x.peerName)g.name=x.peerName;m.set(x.peerEmail,g);
  }
  return [...m.values()].map(g=>{
    g.items.sort((a,b)=>a.at-b.at);
    g.last=g.items[g.items.length-1];
    g.unread=g.items.filter(x=>x.dir==='in'&&x.labels.includes('UNREAD')).length;
    g.category=autoCategory(g);
    g.categoryName=categoryById(g.category)?.name||'';
    return g;
  }).sort((a,b)=>b.last.at-a.last.at);
}
function time(ms){const d=new Date(ms),n=new Date();if(d.toDateString()===n.toDateString())return d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});return d.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})}
function listAttachmentSummary(m){
  const atts=m.attachments||[];
  if(!atts.length)return {text:'',html:''};
  const photos=atts.filter(isImageFile),pdfs=atts.filter(isPdfFile),others=atts.filter(f=>!isImageFile(f)&&!isPdfFile(f));
  const parts=[];
  if(photos.length)parts.push('写真 '+photos.length+'枚');
  if(pdfs.length)parts.push('PDF '+pdfs.length+'件');
  if(others.length)parts.push('ファイル '+others.length+'件');
  const chips=atts.slice(0,2).map(f=>{
    if(isImageFile(f)){
      return '<span class="list-att list-photo">'+(f.previewData?'<img src="'+f.previewData+'" alt="">':'🖼️')+'<span>'+esc(f.name)+'</span></span>';
    }
    if(isPdfFile(f))return '<span class="list-att list-file">📄 <span>'+esc(f.name)+'</span></span>';
    return '<span class="list-att list-file">📎 <span>'+esc(f.name)+'</span></span>';
  }).join('')+(atts.length>2?'<span class="list-more">+'+(atts.length-2)+'</span>':'');
  return {text:parts.join('・'),html:'<span class="list-atts">'+chips+'</span>'};
}
function renderList(){
  const q=query.trim().toLowerCase();
  const gs=groups().filter(g=>filter==='all'||(filter==='unread'?g.unread:filter==='starred'?favorites.has(g.email):filter.startsWith('cat:')?g.category===filter.slice(4):true)).filter(g=>!q||[g.name,g.email,g.categoryName,...g.items.flatMap(x=>[x.subject,x.body,...(x.attachments||[]).map(a=>a.name)])].some(s=>String(s).toLowerCase().includes(q)));
  updateListBack();
  list.innerHTML=gs.map(g=>{
    const last=g.last,att=listAttachmentSummary(last);
    const bodyText=(last.body||'').replace(/\s+/g,' ').trim();
    const preview=bodyText||att.text||'';
    const subject=last.subject||'（件名なし）';
    const sent=last.dir==='out';
    return '<div class="talk-item">'+
      '<button class="row talk-row '+(active===g.email?'sel':'')+(g.unread?' unread-row':'')+'" data-open="'+esc(g.email)+'">'+
        '<span class="avatar '+avatarClass(g.email||g.name)+'">'+esc((g.name||'?').slice(0,1))+'</span>'+
        '<span class="rowmain">'+
          '<span class="r1 list-top"><span class="name">'+esc(g.name)+'</span><span class="list-right"><span class="time">'+time(last.at)+'</span>'+(g.unread?'<span class="badge">'+g.unread+'</span>':'')+'</span></span>'+
          '<span class="subject list-subject"><span class="cat-badge">'+esc(g.categoryName)+'</span> '+(sent?'<span class="sent-mark">↗</span> ':'')+esc(subject)+'</span>'+
          '<span class="preview list-preview">'+(sent&&preview?'<span class="self-prefix">自分: </span>':'')+esc(preview.slice(0,86))+'</span>'+
          att.html+
        '</span>'+
      '</button>'+
      '<button type="button" class="talk-star '+(favorites.has(g.email)?'on':'')+'" data-star="'+esc(g.email)+'" aria-label="お気に入り">'+(favorites.has(g.email)?'★':'☆')+'</button>'+
    '</div>';
  }).join('')||'<div class="empty"><p>該当するトークはありません。</p></div>';
}
function renderFilters(){
  updateListBack();
  const box=$('#filters'),gs=groups();
  const base='<button class="chip '+(filter==='all'?'active':'')+'" data-filter="all">すべて</button><button class="chip '+(filter==='unread'?'active':'')+'" data-filter="unread">未読</button><button class="chip '+(filter==='starred'?'active':'')+'" data-filter="starred">★ お気に入り'+(favorites.size?' <span class="chip-count">'+favorites.size+'</span>':'')+'</button>';
  const cats=categories.map(c=>{
    const count=gs.filter(g=>g.category===c.id).length;
    if(!count)return '';
    const key='cat:'+c.id;
    return '<button class="chip '+(filter===key?'active':'')+'" data-filter="'+esc(key)+'">'+esc(c.name)+' <span class="chip-count">'+count+'</span></button>';
  }).join('');
  box.innerHTML=base+cats;
}
function render(){renderFilters();renderList();if(tab==='settings')showSettings();else if(active)showChat(active);else if(tab==='talks')showEmpty()}
function showEmpty(){tab='talks';main.innerHTML='<section class="empty"><h2>Gmailを、相手ごとの会話に。</h2><p>同じ相手からのメールは、件名が変わっても1つのトークにまとめます。</p><button class="primary" data-sync>Gmailを読み込む</button></section>';app.classList.remove('inmain')}
function renderMailText(text,compactMode=false){
  const raw=String(text||'').replace(/\r/g,'');
  const lines=raw.split('\n');
  let cut=-1;
  const quotePatterns=[/^On .+wrote:\s*$/i,/^From:\s/i,/^-{2,}\s*Original Message\s*-{2,}$/i,/^20\d\d年\d{1,2}月\d{1,2}日.+<[^>]+>.*[:：]\s*$/];
  for(let i=1;i<lines.length;i++){if(quotePatterns.some(re=>re.test(lines[i].trim()))){cut=i;break}}
  const compact=s=>String(s||'').replace(/[ \t]+\n/g,'\n').replace(/\n{2,}/g,'\n').trim();
  let main=compact(cut>0?lines.slice(0,cut).join('\n'):raw);if(compactMode)main=main.split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
  const quoted=cut>0?lines.slice(cut).join('\n').replace(/\n{3,}/g,'\n\n').trim():'';
  let html=compactMode?'<div class="mailtext order-list">'+main.split('\n').map(line=>'<div>'+esc(line)+'</div>').join('')+'</div>':'<div class="mailtext">'+esc(main).replace(/\n/g,'<br>')+'</div>';
  if(quoted)html+='<details class="quoted"><summary>過去の引用を表示</summary><div>'+esc(quoted).replace(/\n/g,'<br>')+'</div></details>';
  return html;
}
function autoGrowReplyTextarea(ta){
  if(!ta)return;
  ta.style.height='auto';
  const viewport=Math.max(220,Math.floor((window.visualViewport?.height||window.innerHeight||700)*0.46));
  ta.style.height=Math.min(ta.scrollHeight,viewport)+'px';
}
function showChat(email){
  active=email;tab='talks';app.classList.add('inmain');clearComposeFiles();
  const g=groups().find(x=>x.email===email);if(!g)return showEmpty();
  if(!replyId||!g.items.some(x=>x.id===replyId&&x.dir==='in'))replyId=(g.items.filter(x=>x.dir==='in').at(-1)||{}).id||'';
  const bubbles=g.items.map(x=>'<div class="wrap '+(x.dir==='out'?'out':'')+'"><div class="bubble"><div class="subj">'+esc(x.subject)+'</div>'+renderMailText(x.body,x.dir==='out')+renderAttachments(x)+'</div><div class="meta"><span>'+time(x.at)+'</span>'+(x.dir==='in'?'<button class="replypick" data-reply="'+x.id+'">このメールに返信</button>':'')+'</div></div>').join('');
  const target=g.items.find(x=>x.id===replyId);
  const replyRecipient=target?(addr(target.replyTo||target.from).email||g.email):g.email;
  const draftKey=target?replyId:'new:'+g.email;
  const d=drafts[draftKey]||'';
  const newSubject=localStorage.getItem('mt-subject:'+g.email)||'';
  const catOptions='<option value="">自動分類</option>'+categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  main.innerHTML='<header class="chathead"><button class="back" data-back>‹</button><div class="avatar">'+esc((g.name||'?').slice(0,1))+'</div><div class="title"><strong>'+esc(g.name)+'</strong><small>'+esc(g.email)+'</small></div><select id="chatCategory" class="chat-category" aria-label="分類">'+catOptions+'</select></header><div class="msgs">'+bubbles+'</div><form class="composer" id="compose"><div class="target">'+(target?'返信先：'+esc(target.subject)+' → '+esc(replyRecipient):'新規メール → '+esc(g.email))+'</div>'+(!target?'<input id="newSubject" class="subject-input" maxlength="200" placeholder="件名（任意）" value="'+esc(newSubject)+'">':'')+'<div class="compose-tools"><button type="button" class="attach-pick" data-attach-pick>📎 添付</button><input id="attachInput" type="file" multiple hidden><div id="composeFiles" class="compose-files"></div></div><div class="compose"><textarea id="replyText" placeholder="'+(target?'返信本文（任意）':'本文（任意）')+'">'+esc(d)+'</textarea><button class="send" type="submit">➤</button></div></form>';
  const ta=$('#replyText');
  if(ta){
    const fit=()=>autoGrowReplyTextarea(ta);
    ta.addEventListener('input',()=>{drafts[draftKey]=ta.value;localStorage.setItem('mt-drafts',JSON.stringify(drafts));fit()});
    window.visualViewport?.addEventListener('resize',fit,{once:true});
    requestAnimationFrame(fit);
  }
  $('#newSubject')?.addEventListener('input',e=>localStorage.setItem('mt-subject:'+g.email,e.target.value));
  $('#attachInput')?.addEventListener('change',e=>{setComposeFiles(e.target.files);e.target.value=''});
  $('#compose')?.addEventListener('submit',sendReply);
  const cs=$('#chatCategory');if(cs){cs.value=categoryOverrides[g.email]||'';cs.addEventListener('change',()=>{if(cs.value)categoryOverrides[g.email]=cs.value;else delete categoryOverrides[g.email];saveCategoryOverrides();renderFilters();renderList()});}
  setTimeout(()=>{const s=$('.msgs');if(s)s.scrollTop=s.scrollHeight;setupAttachmentPreviews()},0);
}
function wrap76(s){
  const str=String(s||'');
  let out='';
  for(let i=0;i<str.length;i+=76)out+=(out?'\r\n':'')+str.slice(i,i+76);
  return out;
}
async function fileBase64(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let raw='';
  for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(raw);
}
function cleanHeaderValue(s){return String(s||'').replace(/[\r\n]+/g,' ').trim()}
async function buildMimeMessage({to,subject,text,reply,files=[]}){
  const head=['To: '+cleanHeaderValue(to)];if(subject)head.push('Subject: '+mimeHeader(subject));
  if(reply){
    if(reply.messageId)head.push('In-Reply-To: '+cleanHeaderValue(reply.messageId));
    const refs=[reply.refs,reply.messageId].filter(Boolean).join(' ');
    if(refs)head.push('References: '+cleanHeaderValue(refs));
  }
  head.push('MIME-Version: 1.0');
  if(!files.length){
    head.push('Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',text);
    return head.join('\r\n');
  }
  const boundary='mt_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  head.push('Content-Type: multipart/mixed; boundary="'+boundary+'"','',
    '--'+boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit','',text);
  for(const file of files){
    const type=cleanHeaderValue(file.type||'application/octet-stream');
    const name=cleanHeaderValue(file.name||'attachment');
    const nameStar=encodeURIComponent(name);
    const b64=wrap76(await fileBase64(file));
    head.push('--'+boundary,
      "Content-Type: "+type+"; name*=UTF-8''"+nameStar,
      'Content-Transfer-Encoding: base64',
      "Content-Disposition: attachment; filename*=UTF-8''"+nameStar,
      '',b64);
  }
  head.push('--'+boundary+'--','');
  return head.join('\r\n');
}
function getComposePreviewUrl(file){
  if(composePreviewUrls.has(file))return composePreviewUrls.get(file);
  const url=URL.createObjectURL(file);composePreviewUrls.set(file,url);return url;
}
function revokeComposePreview(file){
  const url=composePreviewUrls.get(file);
  if(url){try{URL.revokeObjectURL(url)}catch(_){}composePreviewUrls.delete(file)}
}
function clearComposeFiles(){
  composeFiles.forEach(revokeComposePreview);composeFiles=[];
}
function previewComposeFile(index){
  const file=composeFiles[index];if(!file)return;
  const type=file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'application/octet-stream');
  const info={url:getComposePreviewUrl(file),blob:file,name:file.name,type,size:file.size,messageId:'',compose:true};
  showAttachmentViewer(info);
}
function renderComposeFiles(){
  const box=$('#composeFiles');if(!box)return;
  box.innerHTML=composeFiles.map((f,i)=>{
    const img=/^image\//i.test(f.type||'')||/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name||'');
    const pdf=/pdf/i.test(f.type||'')||/\.pdf$/i.test(f.name||'');
    const icon=img?'🖼️':pdf?'📄':'📎';
    const preview=img?'<span class="compose-thumb"><img src="'+getComposePreviewUrl(f)+'" alt=""></span>':'<span class="compose-file-icon">'+icon+'</span>';
    return '<span class="compose-file-card">'+
      '<button type="button" class="compose-file-preview" data-compose-preview="'+i+'" title="送信前に確認">'+preview+'<span class="compose-file-name">'+esc(f.name)+'</span></button>'+
      '<button type="button" class="compose-file-remove" data-file-remove="'+i+'" aria-label="添付を外す">×</button>'+
      '</span>';
  }).join('');
}
function setComposeFiles(fileList){
  const incoming=[...fileList];
  const merged=[...composeFiles,...incoming].slice(0,MAX_SEND_FILES);
  const total=merged.reduce((n,f)=>n+(f.size||0),0);
  if(total>MAX_SEND_BYTES){say('添付は合計10MBまでで試してください。');return}
  composeFiles=merged;
  renderComposeFiles();
}
async function sendReply(e){
  e.preventDefault();
  const g=groups().find(x=>x.email===active),t=g?.items.find(x=>x.id===replyId);
  const text=$('#replyText').value.trim();
  if(!g)return say('宛先を確認してください。');
  const isReply=!!t;
  const subj=isReply?(/^re:/i.test(t.subject)?t.subject:'Re: '+t.subject):($('#newSubject')?.value.trim()||'');
  if(!text&&!composeFiles.length)return say('本文か添付ファイルのどちらかを入れてください。');
  const toAddr=isReply?(addr(t.replyTo||t.from).email||g.email):g.email;
  const fileNames=composeFiles.map(f=>f.name);
  const confirmText='宛先: '+toAddr+'\n件名: '+(subj||'（なし）')+'\n本文: '+(text?'入力あり':'（なし）')+(fileNames.length?'\n添付: '+fileNames.join(', '):'')+'\n\nこの内容をGmailから送信しますか？';
  if(!confirm(confirmText))return;
  try{
    await getToken(READ+' '+SEND);
    const mime=await buildMimeMessage({to:toAddr,subject:subj,text,reply:isReply?t:null,files:composeFiles});
    const payload={raw:enc(mime)};if(isReply)payload.threadId=t.threadId;
    const sent=await api('/messages/send',{method:'POST',scope:READ+' '+SEND,body:JSON.stringify(payload)});
    const full=await api('/messages/'+sent.id+'?format=full');
    const sm=simple(full);
    // Reuse the just-selected local files so sent photo thumbnails appear immediately,
    // without another Gmail attachment download.
    const used=new Set();
    for(const att of sm.attachments||[]){
      const fi=composeFiles.findIndex((f,i)=>!used.has(i)&&f.name===att.name);
      if(fi>=0){
        used.add(fi);
        const f=composeFiles[fi];
        const key=attachmentKey(sm.id,att.name);
        if(!attachmentCache.has(key)){
          attachmentCache.set(key,{
            url:URL.createObjectURL(f),
            blob:f,
            name:att.name,
            type:att.type||f.type||'application/octet-stream',
            size:att.size||f.size||0,
            messageId:sm.id
          });
        }
        if(isImageFile(att)){
          const thumb=await makeThumbDataUrl(f);
          if(thumb)att.previewData=thumb;
        }
      }
    }
    const idx=msgs.findIndex(x=>x.id===sm.id);if(idx>=0)msgs[idx]=sm;else msgs.push(sm);
    msgs.sort((a,b)=>a.at-b.at);saveCache();
    const draftKey=isReply?replyId:'new:'+g.email;delete drafts[draftKey];localStorage.setItem('mt-drafts',JSON.stringify(drafts));
    if(!isReply)localStorage.removeItem('mt-subject:'+g.email);
    clearComposeFiles();
    const threaded=isReply&&sent.threadId===t.threadId;
    say(threaded?'同じスレッドに返信しました':'送信しました');
    showChat(active);renderList();
  }catch(e2){say('送信できません: '+e2.message)}
}
function showNewCompose(){
  tab='compose';active='';replyId='';app.classList.add('inmain');clearComposeFiles();
  main.innerHTML='<header class="settings-head compose-head"><button type="button" class="back settings-back" data-compose-back>‹</button><h2>新規メール</h2></header>'+
    '<form class="page new-compose-page" id="newComposeForm">'+
      '<section class="card">'+
        '<div class="field"><label>宛先</label><input id="newTo" type="email" inputmode="email" autocomplete="email" placeholder="example@gmail.com"></div>'+
        '<div class="field"><label>件名（任意）</label><input id="newSubjectDirect" maxlength="200" placeholder="件名なしでも送れます"></div>'+
        '<div class="compose-tools"><button type="button" class="attach-pick" data-attach-pick>📎 添付</button><input id="attachInput" type="file" multiple hidden><div id="composeFiles" class="compose-files"></div></div>'+
        '<div class="field"><label>本文（任意）</label><textarea id="newBodyDirect" rows="8" placeholder="本文なしでも添付だけ送れます"></textarea></div>'+
        '<div class="actions"><button type="submit" class="primary compose-send-main">送信</button></div>'+
      '</section>'+
    '</form>';
  $('#attachInput')?.addEventListener('change',e=>{setComposeFiles(e.target.files);e.target.value=''});
  $('#newComposeForm')?.addEventListener('submit',sendNewMessage);
  setTimeout(()=>$('#newTo')?.focus(),0);
}
async function cacheSentComposeAttachments(sm,files){
  const used=new Set();
  for(const att of sm.attachments||[]){
    const fi=files.findIndex((f,i)=>!used.has(i)&&f.name===att.name);
    if(fi<0)continue;
    used.add(fi);const f=files[fi],key=attachmentKey(sm.id,att.name);
    if(!attachmentCache.has(key))attachmentCache.set(key,{url:URL.createObjectURL(f),blob:f,name:att.name,type:att.type||f.type||'application/octet-stream',size:att.size||f.size||0,messageId:sm.id});
    if(isImageFile(att)){const thumb=await makeThumbDataUrl(f);if(thumb)att.previewData=thumb}
  }
}
async function sendNewMessage(e){
  e.preventDefault();
  const rawTo=$('#newTo')?.value.trim()||'',toAddr=emails(rawTo)[0]||'';
  const subject=$('#newSubjectDirect')?.value.trim()||'',text=$('#newBodyDirect')?.value.trim()||'';
  if(!toAddr)return say('正しい宛先メールアドレスを入力してください。');
  if(!subject&&!text&&!composeFiles.length)return say('件名・本文・添付のどれかを入れてください。');
  const names=composeFiles.map(f=>f.name);
  if(!confirm('宛先: '+toAddr+'\n件名: '+(subject||'（なし）')+'\n本文: '+(text?'入力あり':'（なし）')+(names.length?'\n添付: '+names.join(', '):'')+'\n\nこの内容を送信しますか？'))return;
  const usedFiles=[...composeFiles];
  try{
    await getToken(READ+' '+SEND);
    const mime=await buildMimeMessage({to:toAddr,subject,text,reply:null,files:usedFiles});
    const sent=await api('/messages/send',{method:'POST',scope:READ+' '+SEND,body:JSON.stringify({raw:enc(mime)})});
    const full=await api('/messages/'+sent.id+'?format=full'),sm=simple(full);
    await cacheSentComposeAttachments(sm,usedFiles);
    const idx=msgs.findIndex(x=>x.id===sm.id);if(idx>=0)msgs[idx]=sm;else msgs.push(sm);
    msgs.sort((a,b)=>a.at-b.at);saveCache();clearComposeFiles();
    history.replaceState({mt:'chat'},'',location.href);
    active=sm.peerEmail||toAddr;replyId='';showChat(active);renderFilters();renderList();say('送信しました');
  }catch(err){say('送信できません: '+err.message)}
}
function showSettings(){
  tab='settings';active='';app.classList.add('inmain');$$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='settings'));
  const catRows=categories.map((c,i)=>'<div class="cat-row" data-cat-id="'+esc(c.id)+'"><input class="cat-name" value="'+esc(c.name)+'" aria-label="分類名"><textarea class="cat-keywords" rows="2" placeholder="キーワードをカンマ区切り">'+esc(c.keywords||'')+'</textarea>'+(c.id!=='other'?'<button type="button" class="cat-delete" data-cat-delete="'+esc(c.id)+'">削除</button>':'')+'</div>').join('');
  main.innerHTML='<header class="settings-head"><button type="button" class="back settings-back" data-settings-back>‹</button><h2>設定</h2></header><div class="page settings-page">'+
  '<section class="card"><h3>Gmail接続</h3><div class="field"><label>OAuth Client ID</label><input id="clientId" value="'+esc(settings.clientId)+'" placeholder="xxxxx.apps.googleusercontent.com"></div><div class="settings-grid"><div class="field"><label>読み込む期間</label><select id="days"><option value="7">7日</option><option value="30">30日</option><option value="90">90日</option><option value="180">180日</option><option value="365">1年</option><option value="730">2年</option></select></div><div class="field"><label>最大メール数</label><select id="max"><option>50</option><option>80</option><option>100</option><option>200</option><option>500</option><option>1000</option></select></div></div><div class="actions"><button class="primary" data-save-main>保存</button><button class="secondary" data-sync>Gmailを接続・読み込む</button></div></section>'+
  '<section class="card"><h3>自動振り分け</h3><p>同じ相手は1つのトークのまま、件名・本文・添付名から分類します。Gmail本体のラベルは変更しません。</p><div id="categoryRows">'+catRows+'</div><div class="actions"><button class="secondary" data-cat-add>＋分類を追加</button><button class="secondary" data-cat-reset>初期状態に戻す</button><button class="primary" data-cat-save>分類を保存</button></div></section>'+
  '<section class="card"><h3>見た目</h3><div class="settings-grid"><div class="field"><label>テーマ</label><select id="themeSel"><option value="line">LINE風</option><option value="gmail">Gmail風</option><option value="cute">かわいい系</option><option value="dark">ダーク</option></select></div><div class="field"><label>文字サイズ</label><select id="sizeSel"><option value="small">小さめ</option><option value="normal">標準</option><option value="large">大きめ</option></select></div><div class="field"><label>フォント</label><select id="fontSel"><option value="system">標準</option><option value="rounded">丸ゴシック風</option><option value="mincho">明朝</option></select></div><div class="field"><label>アクセント色</label><input id="accentSel" type="color" value="'+esc(appearance.accent||'#1a73e8')+'"></div></div><div class="actions"><button class="primary" data-appearance-save>見た目を保存</button></div></section>'+
  '<section class="card"><h3>接続チェック</h3><div class="'+(location.protocol==='https:'?'ok':'notice')+'">'+(location.protocol==='https:'?'HTTPSで開いています。':'HTTPSで公開してから使ってください。')+'</div><p>この公開テスト版は、Gmailの読み取りと返信送信を使います。削除・アーカイブ・既読変更はしません。</p></section></div>';
  $('#days').value=String(settings.days);$('#max').value=String(settings.max);
  $('#themeSel').value=appearance.theme||'line';$('#sizeSel').value=appearance.size||'normal';$('#fontSel').value=appearance.font||'system';
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
if(b.hasAttribute('data-list-back')){
  if(history.state?.mt==='filter'||history.state?.mt==='search')history.back();
  else{
    filter='all';query='';const q=$('#searchInput');if(q)q.value='';
    renderFilters();renderList();
  }
  return;
}
if(b.dataset.star){toggleFavorite(b.dataset.star);return}
if(b.hasAttribute('data-compose-new')){if(history.state?.mt!=='compose')history.pushState({mt:'compose'},'',location.href);showNewCompose();return}
if(b.hasAttribute('data-compose-back')){if(history.state?.mt==='compose')history.back();else{tab='talks';active='';app.classList.remove('inmain');renderFilters();renderList()}return}
if(b.hasAttribute('data-save-main')){settings.clientId=$('#clientId').value.trim();settings.days=Number($('#days').value);settings.max=Number($('#max').value);localStorage.setItem('mt-client',settings.clientId);localStorage.setItem('mt-days',settings.days);localStorage.setItem('mt-max',settings.max);say('設定を保存しました');return}
if(b.hasAttribute('data-cat-add')){categories.splice(Math.max(0,categories.length-1),0,{id:'custom_'+Date.now(),name:'新しい分類',keywords:''});showSettings();return}
if(b.dataset.catDelete){categories=categories.filter(c=>c.id!==b.dataset.catDelete);for(const [k,v] of Object.entries(categoryOverrides))if(v===b.dataset.catDelete)delete categoryOverrides[k];saveCategoryOverrides();showSettings();return}
if(b.hasAttribute('data-cat-reset')){categories=DEFAULT_CATEGORIES.map(x=>({...x}));categoryOverrides={};saveCategories();saveCategoryOverrides();filter='all';showSettings();say('分類を初期状態に戻しました');return}
if(b.hasAttribute('data-cat-save')){$('.cat-row').forEach(row=>{const c=categoryById(row.dataset.catId);if(c){c.name=row.querySelector('.cat-name')?.value.trim()||c.name;c.keywords=row.querySelector('.cat-keywords')?.value.trim()||''}});saveCategories();renderFilters();renderList();say('分類を保存しました');return}
if(b.hasAttribute('data-appearance-save')){appearance={theme:$('#themeSel').value,font:$('#fontSel').value,size:$('#sizeSel').value,accent:$('#accentSel').value};saveAppearance();say('見た目を保存しました');return}
if(b.hasAttribute('data-settings-back')){
  if(history.state?.mt==='settings')history.back();
  else{tab='talks';active='';replyId='';app.classList.remove('inmain');renderFilters();renderList();$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.tab==='talks'))}
  return;
}if(b.hasAttribute('data-attach-pick')){$('#attachInput')?.click();return}if(b.dataset.composePreview!==undefined){previewComposeFile(Number(b.dataset.composePreview));return}if(b.dataset.fileRemove!==undefined){const i=Number(b.dataset.fileRemove);if(Number.isInteger(i)&&composeFiles[i]){const removed=composeFiles.splice(i,1)[0];revokeComposePreview(removed);renderComposeFiles()}return}if(b.hasAttribute('data-att-close')){closeAttachmentViewer();return}if(b.hasAttribute('data-att-download')){if(attachmentView)downloadAttachment(attachmentView);return}if(b.hasAttribute('data-att-external')){if(attachmentView)openExternalAttachment(attachmentView);return}if(b.hasAttribute('data-pdf-prev')){const st=attachmentView?.pdf;if(st&&st.page>1){st.page--;st.zoom=1;renderPdfPage().then(()=>{const s=$('.pdf-canvas-stage');if(s){s.scrollLeft=0;s.scrollTop=0}})}return}
if(b.hasAttribute('data-pdf-next')){const st=attachmentView?.pdf;if(st&&st.page<st.doc.numPages){st.page++;st.zoom=1;renderPdfPage().then(()=>{const s=$('.pdf-canvas-stage');if(s){s.scrollLeft=0;s.scrollTop=0}})}return}
if(b.hasAttribute('data-pdf-minus')){const st=attachmentView?.pdf;if(st){const stage=$('.pdf-canvas-stage'),focus=stage?{x:stage.clientWidth/2,y:stage.clientHeight/2}:null;st.zoom=Math.max(.4,st.zoom/1.35);renderPdfPage(focus)}return}
if(b.hasAttribute('data-pdf-plus')){const st=attachmentView?.pdf;if(st){const stage=$('.pdf-canvas-stage'),focus=stage?{x:stage.clientWidth/2,y:stage.clientHeight/2}:null;st.zoom=Math.min(8,st.zoom*1.35);renderPdfPage(focus)}return}
if(b.hasAttribute('data-pdf-fit')){const st=attachmentView?.pdf;if(st){st.zoom=1;renderPdfPage().then(()=>{const s=$('.pdf-canvas-stage');if(s){s.scrollLeft=0;s.scrollTop=0}})}return}if(b.dataset.attOpen){openAttachment(b.dataset.msgId,b.dataset.attName);return}if(b.dataset.open){if(history.state?.mt!=='chat')history.pushState({mt:'chat'},'',location.href);active=b.dataset.open;replyId='';showChat(active);renderList()}if(b.dataset.filter){
  const next=b.dataset.filter;
  if(next==='all'){
    if(history.state?.mt==='filter')history.back();
    else{filter='all';render()}
  }else{
    if(history.state?.mt==='filter')history.replaceState({mt:'filter'},'',location.href);
    else history.pushState({mt:'filter'},'',location.href);
    filter=next;render();
  }
  return;
}if(b.dataset.reply){replyId=b.dataset.reply;showChat(active)}if(b.hasAttribute('data-back')){if(history.state?.mt==='chat')history.back();else{active='';replyId='';showEmpty();renderList()}}if(b.dataset.tab==='talks'){tab='talks';active='';app.classList.remove('inmain');render()}if(b.dataset.tab==='settings'){if(history.state?.mt!=='settings')history.pushState({mt:'settings'},'',location.href);showSettings();return}if(b.dataset.sync!==undefined)sync();if(b.dataset.save!==undefined){settings.clientId=$('#clientId').value.trim();settings.days=Number($('#days').value);settings.max=Number($('#max').value);localStorage.setItem('mt-client',settings.clientId);localStorage.setItem('mt-days',settings.days);localStorage.setItem('mt-max',settings.max);say('設定を保存しました')}})
document.addEventListener('change',e=>{
  if(['themeSel','fontSel','sizeSel','accentSel'].includes(e.target.id)){
    appearance={theme:$('#themeSel')?.value||appearance.theme,font:$('#fontSel')?.value||appearance.font,size:$('#sizeSel')?.value||appearance.size,accent:$('#accentSel')?.value||appearance.accent};
    applyAppearance();
  }
});
$('#searchInput').addEventListener('input',e=>{
  const next=e.target.value;
  if(next&&!query&&history.state?.mt!=='search')history.pushState({mt:'search'},'',location.href);
  query=next;renderList();
});
$('#clearSearch').addEventListener('click',()=>{
  if(history.state?.mt==='search')history.back();
  else{$('#searchInput').value='';query='';renderList()}
});$('#syncBtn').addEventListener('click',sync);
window.__mailTalkHandleAndroidBack=()=>{
  if($('.attachment-viewer')){
    closeAttachmentViewer(false);
    try{history.replaceState({mt:tab==='compose'?'compose':active?'chat':tab==='settings'?'settings':'root'},'',location.href)}catch(_){}
    return true;
  }
  if(tab==='settings'||tab==='compose'||active||app.classList.contains('inmain')){
    clearComposeFiles();
    active='';replyId='';tab='talks';
    app.classList.remove('inmain');
    renderFilters();renderList();showEmpty();
    $('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='talks'));
    try{history.replaceState({mt:'root'},'',location.href)}catch(_){}
    return true;
  }
  if(filter!=='all'||query.trim()){
    filter='all';query='';
    const q=$('#searchInput');if(q)q.value='';
    renderFilters();renderList();
    try{history.replaceState({mt:'root'},'',location.href)}catch(_){}
    return true;
  }
  return false;
};
window.addEventListener('popstate',e=>{
  if($('.attachment-viewer')){closeAttachmentViewer(false);return}
  if(tab==='settings'||tab==='compose'||active||app.classList.contains('inmain')){
    active='';replyId='';tab='talks';app.classList.remove('inmain');
    renderFilters();renderList();showEmpty();
    $$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='talks'));
    return;
  }
  if(filter!=='all'||query.trim()){
    filter='all';query='';const q=$('#searchInput');if(q)q.value='';
    renderFilters();renderList();
  }
});
window.addEventListener('resize',()=>{if(attachmentView?.pdf){clearTimeout(attachmentView.pdf.resizeTimer);attachmentView.pdf.resizeTimer=setTimeout(renderPdfPage,120)}});
window.addEventListener('beforeunload',()=>{attachmentCache.forEach(x=>{try{URL.revokeObjectURL(x.url)}catch(_){}});composePreviewUrls.forEach(url=>{try{URL.revokeObjectURL(url)}catch(_){}})});
applyAppearance();
restoreCache();
render();
