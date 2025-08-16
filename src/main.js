import '@google/model-viewer';

const mv = document.getElementById('mv');
const preset = document.getElementById('preset');
const glbInput = document.getElementById('glb');
const resetBtn = document.getElementById('reset');
const shareBtn = document.getElementById('share');

const overlay = document.getElementById('progress');
const fillEl = document.getElementById('progressFill');
const pctEl = document.getElementById('progressPct');
const msgEl = document.getElementById('progressMsg');

let localBlobURL, remoteBlobURL, fetchCtrl = null, loadTicket = 0;

// ---- 工具：正規化 src（解 %2F / 去開頭斜線 / 處理雙重編碼）----
function normalizeSrc(s){
  if(!s) return s;
  try{s = decodeURIComponent(s);}catch{}
  try{s = decodeURIComponent(s);}catch{}
  return s.replace(/^\/+/, '');
}

// ---- 寫回網址（不讓 / 被編碼）----
function setQuerySrc(src){
  const u = new URL(location.href);
  if (src) {
    // encodeURI 會保留 '/'，只處理空白和其他特殊字元
    u.search = '?src=' + encodeURI(src);
  } else {
    u.search = '';
  }
  history.replaceState(null, '', u.toString());
}

// 初始化：載入清單、讀 ?src=
(async () => {
  try {
    const r = await fetch('models/manifest.json', { cache: 'no-store' });
    if (r.ok){
      const list = await r.json();
      for (const it of list){
        const o = document.createElement('option');
        o.value = it.src; o.textContent = it.label; preset.appendChild(o);
      }
    }
  } catch {}
  const p = new URLSearchParams(location.search);
  const s = normalizeSrc(p.get('src'));
  if (s){
    preset.value = [...preset.options].find(o => o.value === s)?.value || '';
    loadFromURL(s).catch(showError);
  }
})();

// 選單載入
preset.addEventListener('change', () => {
  if (!preset.value) return;
  const s = normalizeSrc(preset.value);
  loadFromURL(s).catch(showError);
  updateShare(s);
});

// 上傳本機
glbInput.onchange = async () => {
  const f = glbInput.files?.[0]; if (!f) return;
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  localBlobURL = URL.createObjectURL(f);
  const ticket = ++loadTicket;
  beginOverlay('準備讀取本機檔…', 0);
  try { await setModelSrcAndWait(localBlobURL, ticket); endOverlayOK(); preset.value=''; updateShare(''); setQuerySrc(''); }
  catch(e){ if(ticket!==loadTicket) return; showError(e); }
};

// 重置視角
resetBtn.onclick = () => {
  if (mv.resetTurntableRotation) mv.resetTurntableRotation();
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
};

// 分享連結（用不編碼 / 的方式組網址）
shareBtn.onclick = async () => {
  const src = currentRemoteSrc();
  if (!src) return alert('目前是本機檔或尚未載入遠端模型，無法分享連結。');
  const link = location.origin + location.pathname + '?src=' + encodeURI(src);
  try { await navigator.clipboard.writeText(link); alert('連結已複製：\n' + link); }
  catch { prompt('請手動複製這個連結：', link); }
};

// 拖拉檔案
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const [file] = e.dataTransfer.files; if (!file) return;
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  localBlobURL = URL.createObjectURL(file);
  const ticket = ++loadTicket;
  beginOverlay('準備讀取本機檔…', 0);
  setModelSrcAndWait(localBlobURL, ticket).then(() => { endOverlayOK(); setQuerySrc(''); }).catch(showError);
  preset.value=''; updateShare('');
});

// ========= 帶進度下載 + 穩定關遮罩 =========
async function loadFromURL(srcRaw){
  const src = normalizeSrc(srcRaw);
  if (fetchCtrl) fetchCtrl.abort();
  fetchCtrl = new AbortController();

  const ticket = ++loadTicket;
  beginOverlay('連線中…', 0);

  try {
    const blobURL = await fetchToBlobURL(new URL(src, location).href, info=>{
      if(ticket!==loadTicket) return;
      const {pct,received,total} = info;
      const mb = (received/1048576).toFixed(1);
      updateOverlay(pct ?? 0, total ? `下載中…（${mb} MB）` : `下載中…（${mb} MB / 未知大小）`);
    }, fetchCtrl.signal);

    if (remoteBlobURL) URL.revokeObjectURL(remoteBlobURL);
    remoteBlobURL = blobURL;

    updateOverlay(100, '解碼中…');
    await setModelSrcAndWait(remoteBlobURL, ticket);
    endOverlayOK();

    setQuerySrc(src); // ★ 用不編碼 / 的方式寫回網址
  } catch (e){
    if(ticket!==loadTicket) return;
    showError(e);
  }
}

// 串流下載：回報 { pct(0~100|undefined), received, total }
async function fetchToBlobURL(url, onProgress, signal){
  const res = await fetch(url, { mode:'cors', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}（路徑或大小寫可能錯了）`);
  if (!res.body){
    const buf = await res.arrayBuffer();
    onProgress?.({ pct:100, received:buf.byteLength, total:buf.byteLength });
    return URL.createObjectURL(new Blob([buf], { type:'model/gltf-binary' }));
  }
  const reader = res.body.getReader();
  const total = Number(res.headers.get('Content-Length')) || 0;
  const chunks=[]; let received=0;
  while(true){
    const {value,done} = await reader.read();
    if(done) break;
    chunks.push(value); received += value.length;
    const pct = total ? Math.round(received/total*100) : undefined;
    onProgress?.({ pct, received, total });
  }
  return URL.createObjectURL(new Blob(chunks, { type:'model/gltf-binary' }));
}

// 設 src 並等待：load 或 updateComplete 任一先到；30s 超時保險
function setModelSrcAndWait(objURL, ticket){
  return new Promise((resolve,reject)=>{
    let finished=false;
    const done=(ok,err)=>{
      if(finished) return; finished=true;
      mv.removeEventListener('load', onLoad);
      mv.removeEventListener('error', onError);
      clearTimeout(to);
      ok?resolve():reject(err||new Error('模型載入失敗'));
    };
    const onLoad=()=>{ if(ticket!==loadTicket) return; requestAnimationFrame(()=>done(true)); };
    const onError=()=>done(false, new Error('模型載入失敗'));

    mv.addEventListener('load', onLoad);
    mv.addEventListener('error', onError);

    const to=setTimeout(()=>done(true), 30000); // 最後保險

    mv.setAttribute('crossorigin','anonymous');
    mv.src = objURL;
    mv.cameraOrbit = '0deg 75deg auto';
    mv.cameraTarget = 'auto auto auto';
    mv.cameraControls = true;

    mv.updateComplete?.then(()=>{ if(ticket!==loadTicket) return; done(true); }).catch(()=>{});
  });
}

// UI helpers
function beginOverlay(msg,pct){ updateOverlay(pct,msg); overlay.hidden=false; }
function updateOverlay(pct,msg){
  fillEl.style.width = `${Math.max(0,Math.min(100,pct||0))}%`;
  pctEl.textContent = Number.isFinite(pct)? `${pct}%` : '…';
  if(msg) msgEl.textContent = msg;
}
function endOverlayOK(){ updateOverlay(100,'完成'); setTimeout(()=>{ overlay.hidden=true; updateOverlay(0,''); },250); }
function showError(e){ overlay.hidden=false; updateOverlay(0, e?.message? `載入失敗：${e.message}` : '載入失敗，請檢查路徑或跨域'); }

function updateShare(src){ const on=!!src; shareBtn.disabled=!on; shareBtn.style.opacity=on?1:0.6; }
function currentRemoteSrc(){ const p = new URLSearchParams(location.search); return p.get('src') || ''; }

window.addEventListener('beforeunload', ()=>{
  if(localBlobURL) URL.revokeObjectURL(localBlobURL);
  if(remoteBlobURL) URL.revokeObjectURL(rem
::contentReference[oaicite:0]{index=0}
