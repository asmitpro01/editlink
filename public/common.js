// EditLink shared helpers
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = s => s == null || s === '' ? 'General' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rs = n => '₹' + Number(n||0).toLocaleString('en-IN');
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}
async function api(url, opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});const j=await r.json().catch(()=>({}));if(r.status===401&&url.startsWith('/api/me')){location.href='/';throw new Error('Login karo')}if(!r.ok)throw new Error(j.error||'Error');return j}
function parseTs(str){if(str==null||str==='')return null;const p=String(str).trim().split(':').map(Number);if(p.some(isNaN))return null;return p.reduce((a,b)=>a*60+b,0)}
const waUrl=(phone,msg)=>`https://wa.me/${phone||''}?text=${encodeURIComponent(msg)}`;
const upiUrl=(upi,name,amt,note)=>`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name||'Editor')}&am=${amt}&cu=INR&tn=${encodeURIComponent(note||'EditLink')}`;

function ytId(u){const m=u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);return m&&m[1]}
function driveId(u){const m=u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);return m&&m[1]}
let ytReady=null;function loadYT(){if(ytReady)return ytReady;ytReady=new Promise(r=>{window.onYouTubeIframeAPIReady=r;const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s)});return ytReady}

// Mount a player. Returns {getTime, seek, play, pause, canTime, kind}
function mountPlayer(el, url){
  const yt=ytId(url), dr=driveId(url);
  if(yt){const id='yt'+Math.random().toString(36).slice(2);el.innerHTML=`<div id="${id}"></div>`;
    const P={kind:'yt',canTime:true,getTime:()=>P.p?.getCurrentTime?.()??null,seek:s=>{P.p?.seekTo?.(s,true)},play:()=>P.p?.playVideo?.(),pause:()=>P.p?.pauseVideo?.()};
    loadYT().then(()=>{P.p=new YT.Player(id,{videoId:yt,playerVars:{rel:0,playsinline:1,modestbranding:1}})});return P}
  if(dr){el.innerHTML=`<iframe src="https://drive.google.com/file/d/${dr}/preview" allow="autoplay" allowfullscreen></iframe>`;
    return {kind:'drive',canTime:false,getTime:()=>null,seek:()=>{},play:()=>{},pause:()=>{}}}
  if(/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)||/cloudinary|r2\.dev|bunny|b-cdn/.test(url)){
    el.innerHTML=`<video src="${esc(url)}" controls playsinline controlsList="nodownload" oncontextmenu="return false"></video>`;const v=el.querySelector('video');
    return {kind:'mp4',canTime:true,video:v,getTime:()=>v.currentTime,seek:s=>{v.currentTime=s},play:()=>v.play(),pause:()=>v.pause()}}
  el.innerHTML=`<iframe src="${esc(url)}" allowfullscreen></iframe>`;return {kind:'other',canTime:false,getTime:()=>null,seek:()=>{},play:()=>{},pause:()=>{}}
}

// Drawing layer over a .stage element
function drawLayer(stage){
  const c=document.createElement('canvas');stage.appendChild(c);const ctx=c.getContext('2d');let color='#ff3b3b',down=false,dirty=false;
  const fit=()=>{const r=stage.getBoundingClientRect();if(c.width!==Math.round(r.width*2)){const old=dirty?c.toDataURL():null;c.width=r.width*2;c.height=r.height*2;if(old){const i=new Image();i.onload=()=>ctx.drawImage(i,0,0,c.width,c.height);i.src=old}}};
  new ResizeObserver(fit).observe(stage);fit();
  const pos=e=>{const r=c.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return[(t.clientX-r.left)*c.width/r.width,(t.clientY-r.top)*c.height/r.height]};
  const start=e=>{down=true;dirty=true;const[x,y]=pos(e);ctx.beginPath();ctx.moveTo(x,y);e.preventDefault()};
  const move=e=>{if(!down)return;const[x,y]=pos(e);ctx.lineTo(x,y);ctx.strokeStyle=color;ctx.lineWidth=c.width/180;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();e.preventDefault()};
  const end=()=>down=false;
  c.addEventListener('mousedown',start);c.addEventListener('mousemove',move);window.addEventListener('mouseup',end);
  c.addEventListener('touchstart',start,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',end);
  return {on(){stage.classList.add('drawing')},off(){stage.classList.remove('drawing')},clear(){ctx.clearRect(0,0,c.width,c.height);dirty=false},
    setColor(x){color=x},isDirty:()=>dirty,data:()=>dirty?c.toDataURL('image/png'):null}
}
// Show a saved drawing over the stage for a few seconds
function flashOverlay(stage,src){stage.querySelector('.ovl')?.remove();if(!src)return;const i=document.createElement('img');i.className='ovl';i.src=src;stage.appendChild(i);setTimeout(()=>i.remove(),6000)}
function commentHTML(c,{editor=false}={}){
  return `<li class="${c.done&&!c.from_editor?'done':''} ${c.from_editor?'editor-msg':''}">
  ${editor&&!c.from_editor?`<input type="checkbox" ${c.done?'checked':''} data-id="${c.id}" style="width:auto;margin-top:4px">`:''}
  <span class="ts" data-t="${c.ts??''}" data-d="${c.drawing_file?'/f/'+c.drawing_file:''}">${fmt(c.ts)}</span>
  <div style="flex:1"><div class="txt">${esc(c.text)}</div>
  ${c.transcript?`<div class="mute">“${esc(c.transcript)}”</div>`:''}
  ${c.audio_file?`<audio controls src="/f/${c.audio_file}"></audio>`:''}
  ${c.drawing_file?`<img class="thumb" src="/f/${c.drawing_file}" data-t="${c.ts??''}" data-d="/f/${c.drawing_file}" title="Drawing dekho">`:''}
  <div class="mute">${c.from_editor?'✂️ ':''}${esc(c.author)}</div></div></li>`}
function bindSeek(player,stage){$$('[data-t]').forEach(e=>e.onclick=()=>{if(e.dataset.t!=='')player.seek(+e.dataset.t);player.pause?.();if(e.dataset.d)flashOverlay(stage,e.dataset.d)})}
