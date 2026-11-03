// Shared helpers: video player that can report current time (mp4 / YouTube), Drive & others fall back to iframe
const $ = s => document.querySelector(s);
const fmt = s => s == null ? 'General' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2500)}
async function api(url, opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Error');return j}

function ytId(u){const m=u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);return m&&m[1]}
function driveId(u){const m=u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);return m&&m[1]}

// mounts a player into el; returns {getTime(), seek(s), canTime}
function mountPlayer(el, url){
  const yt = ytId(url), dr = driveId(url);
  if (yt){
    el.innerHTML='<div id="ytp"></div>';
    const P={getTime:()=>P.p?.getCurrentTime?.()??null,seek:s=>{P.p?.seekTo?.(s,true);P.p?.playVideo?.()},canTime:true};
    window.onYouTubeIframeAPIReady=()=>{P.p=new YT.Player('ytp',{videoId:yt,playerVars:{rel:0,playsinline:1}})};
    const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
    return P;
  }
  if (dr){
    el.innerHTML=`<iframe src="https://drive.google.com/file/d/${dr}/preview" allow="autoplay" allowfullscreen></iframe>`;
    return {getTime:()=>null,seek:()=>{},canTime:false};
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || url.includes('cloudinary') ){
    el.innerHTML=`<video src="${esc(url)}" controls playsinline></video>`;
    const v=el.querySelector('video');
    return {getTime:()=>v.currentTime,seek:s=>{v.currentTime=s;v.play()},canTime:true};
  }
  el.innerHTML=`<iframe src="${esc(url)}" allowfullscreen></iframe>`;
  return {getTime:()=>null,seek:()=>{},canTime:false};
}
function parseTs(str){if(!str)return null;const p=String(str).trim().split(':').map(Number);if(p.some(isNaN))return null;return p.reduce((a,b)=>a*60+b,0)}
