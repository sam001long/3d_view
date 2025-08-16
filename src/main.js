import '@google/model-viewer';

const mv = document.getElementById('mv');
const preset = document.getElementById('preset');
const glbInput = document.getElementById('glb');
const resetBtn = document.getElementById('reset');
const shareBtn = document.getElementById('share');

// 進度 UI
const overlay = document.getElementById('progress');
const fillEl = document.getElementById('progressFill');
const pctEl = document.getElementById('progressPct');
const msgEl = document.getElementById('progressMsg');

let localBlobURL, remoteBlobURL;
let fetchCtrl = null;
let loadTicket = 0;

// --- 工具：把 src 正常化（解掉 %2F / 雙重編碼、去掉開頭的 /） ---
function normalizeSrc(s) {
  if (!s) return s;
  try { s = decodeURIComponent(s); } catch {}
  try { s = decodeURIComponent(s); } catch {}       // 有些會被「雙重」編碼
  s = s.replace(/^\/+/, '');                        // 避免打到根目錄
  return s;
}

// -------- 初始化選單與網址參數 ----------
(async () => {
  try {
    const res = await fetch('models/manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const list = await res.json();
      for (const item of list) {
        const opt = document.createElement('option');
        opt.value = item.src;
        opt.textContent = item.label;
        preset.appendChild(opt);
      }
    }
  } catch {}

  const p = new URLSearchParams(location.search);
  const firstSrc = normalizeSrc(p.get('src'));
  if (firstSrc) {
    preset.value = [...preset.options].find(o => o.value === firstSrc)?.value || '';
    loadFromURL(firstSrc).catch(showError);
  }
})();

// -------- 事件：選單載入 ----------
preset.addEventListener('change', () => {
  if (!preset.value) return;
  loadFromURL(normalizeSrc(preset.value)).catch(showError);
  updateShare(preset.value);
});

// -------- 事件：上傳本機 ----------
glbInput.onchange = async () => {
  const f = glbInput.files?.[0];
  if (!f) return;
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  localBlobURL = URL.createObjectURL(f);

  const ticket = ++loadTicket;
  beginOverlay('準備讀取本機檔…', 0);

  try {
    await setModelSrcAndWait(localBlobURL, ticket);
    endOverlayOK();
    preset.value = '';
    updateShare('');
  } catch (err) {
    if (ticket !== loadTicket) return;
    showError(err);
  }
};

// -------- 重置視角 ----------
resetBtn.onclick = () => {
  if (mv.resetTurntableRotation) mv.resetTurntableRotation();
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
};

// -------- 分享連結 ----------
shareBtn.onclick = async () => {
  const url = new URL(location.href);
  const src = currentRemoteSrc();
  if (!src) return alert('目前是本機檔或尚未載入遠端模型，無法分享連結。');
  url.searchParams.set('src', src);
  try {
    await navigator.clipboard.writeText(url.toString());
    alert('連結已複製：\n' + url.toString());
  } catch {
    prompt('請手動複製這個連結：', url.toString());
  }
};

// -------- 拖拉檔案 ----------
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const [file] = e.dataTransfer.files;
  if (!file) return;
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  localBlobURL = URL.createObjectURL(file);
  const ticket = ++loadTicket;
  beginOverlay('準備讀取本機檔…', 0);
  setModelSrcAndWait(localBlobURL, ticket).then(endOverlayOK).catch(showError);
  preset.value = '';
  updateShare('');
});

// =================== 帶進度下載 + 保證關遮罩 ===================
async function loadFromURL(srcRaw) {
  const src = normalizeSrc(srcRaw);

  if (fetchCtrl) fetchCtrl.abort();
  fetchCtrl = new AbortController();

  const ticket = ++loadTicket;
  beginOverlay('連線中…', 0);

  try {
    const blobURL = await fetchToBlobURL(new URL(src, location).href, (info) => {
      if (ticket !== loadTicket) return;
      const { pct, received, total } = info;
      const mb = (received / (1024 * 1024)).toFixed(1);
      const text = total ? `下載中…（${mb} MB）` : `下載中…（${mb} MB / 未知大小）`;
      updateOverlay(pct ?? 0, text);
    }, fetchCtrl.signal);

    if (remoteBlobURL) URL.revokeObjectURL(remoteBlobURL);
    remoteBlobURL = blobURL;

    updateOverlay(100, '解碼中…');
    await setModelSrcAndWait(remoteBlobURL, ticket);

    endOverlayOK();

    const u = new URL(location.href);
    u.searchParams.set('src', src);
    history.replaceState(null, '', u);
  } catch (err) {
    if (ticket !== loadTicket) return;
    showError(err);
  }
}

async function fetchToBlobURL(url, onProgress, signal) {
  const res = await fetch(url, { mode: 'cors', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}（檔案路徑可能錯了，或大小寫不符）`);

  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress?.({ pct: 100, received: buf.byteLength, total: buf.byteLength });
    return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  }

  const reader = res.body.getReader();
  const total = Number(res.headers.get('Content-Length')) || 0;
  const chunks = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = total ? Math.round((received / total) * 100) : undefined;
    onProgress?.({ pct, received, total });
  }

  return URL.createObjectURL(new Blob(chunks, { type: 'model/gltf-binary' }));
}

// 設 src 並等待 load（附 30s 最後手段超時，避免永遠卡住）
function setModelSrcAndWait(objURL, ticket) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      mv.removeEventListener('load', onLoad);
      mv.removeEventListener('error', onError);
      clearTimeout(to);
      ok ? resolve() : reject(err || new Error('模型載入失敗'));
    };
    const onLoad = () => {
      if (ticket !== loadTicket) return;
      requestAnimationFrame(() => finish(true));
    };
    const onError = (e) => finish(false, new Error('模型載入失敗'));

    mv.addEventListener('load', onLoad);
    mv.addEventListener('error', onError);

    // 30 秒保險機制：就算沒有事件也把遮罩關掉，避免看起來像當機
    const to = setTimeout(() => finish(true), 30000);

    mv.setAttribute('crossorigin', 'anonymous');
    mv.src = objURL;
    mv.cameraOrbit = '0deg 75deg auto';
    mv.cameraTarget = 'auto auto auto';
    mv.cameraControls = true;
  });
}

// ========== UI helpers ==========
function beginOverlay(msg, pct){ updateOverlay(pct, msg); overlay.hidden = false; }
function updateOverlay(pct,msg){
  fillEl.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  pctEl.textContent = Number.isFinite(pct) ? `${pct}%` : '…';
  if (msg) msgEl.textContent = msg;
}
function endOverlayOK(){ updateOverlay(100,'完成'); setTimeout(() => { overlay.hidden = true; updateOverlay(0,''); }, 250); }
function showError(err){
  overlay.hidden = false;
  updateOverlay(0, (err && err.message) ? `載入失敗：${err.message}` : '載入失敗，請檢查路徑或跨域 (CORS)');
}
function updateShare(src){ const on=!!src; shareBtn.disabled=!on; shareBtn.style.opacity=on?1:0.6; }
function currentRemoteSrc(){ const p = new URLSearchParams(location.search); return p.get('src') || ''; }

// -------- 釋放資源 ----------
window.addEventListener('beforeunload', () => {
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  if (remoteBlobURL) URL.revokeObjectURL(remoteBlobURL);
  if (fetchCtrl) fetchCtrl.abort();
});
