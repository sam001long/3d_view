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

let localBlobURL;        // 本機檔 objectURL
let remoteBlobURL;       // 遠端下載後的 objectURL
let fetchCtrl = null;    // 下載中可中止
let loadTicket = 0;      // 防抖：只處理最後一次載入

// -------- 初始化選單（讀 public/models/manifest.json） ----------
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
  } catch { /* 沒有清單也沒關係 */ }

  // 如果網址帶 ?src=...
  const p = new URLSearchParams(location.search);
  const firstSrc = p.get('src');
  if (firstSrc) {
    preset.value = [...preset.options].find(o => o.value === firstSrc)?.value || '';
    loadFromURL(firstSrc).catch(showError);
  }
})();

// -------- 事件：選單載入（遠端） ----------
preset.addEventListener('change', () => {
  if (!preset.value) return;
  loadFromURL(preset.value).catch(showError);
  updateShare(preset.value);
});

// -------- 事件：上傳本機 GLB（不會上傳到網路） ----------
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
    // 若被新任務取代就忽略
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

// -------- 複製分享連結（基於目前載入的遠端 src） ----------
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

// -------- 支援把檔案拖進頁面 ----------
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

// =================== 核心：帶進度下載 + 安全載入 ===================

async function loadFromURL(src) {
  // 取消前一個下載
  if (fetchCtrl) fetchCtrl.abort();
  fetchCtrl = new AbortController();

  const ticket = ++loadTicket;

  // 顯示「連線中…」
  beginOverlay('連線中…', 0);

  // 下載（邊下邊顯示百分比/MB）
  try {
    const blobURL = await fetchToBlobURL(new URL(src, location).href, (info) => {
      if (ticket !== loadTicket) return;
      const { pct, received, total } = info;
      const mb = (received / (1024 * 1024)).toFixed(1);
      const text = total ? `下載中…（${mb} MB）` : `下載中…（${mb} MB / 未知大小）`;
      updateOverlay(pct ?? 0, text);
    }, fetchCtrl.signal);

    // 清掉舊的遠端 URL
    if (remoteBlobURL) URL.revokeObjectURL(remoteBlobURL);
    remoteBlobURL = blobURL;

    // 設給 <model-viewer>，並等待真正載入完成
    updateOverlay(100, '解碼中…');
    await setModelSrcAndWait(remoteBlobURL, ticket);

    // 成功
    endOverlayOK();

    // 更新網址（不重整）
    const u = new URL(location.href);
    u.searchParams.set('src', src);
    history.replaceState(null, '', u);
  } catch (err) {
    if (ticket !== loadTicket) return; // 被新任務取代
    throw err;
  }
}

// 以串流下載，回報 { pct(0~100|undefined), received(bytes), total(bytes|0) }
async function fetchToBlobURL(url, onProgress, signal) {
  const res = await fetch(url, { mode: 'cors', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // 沒有 body 讀取器就一次讀完
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress?.({ pct: 100, received: buf.byteLength, total: buf.byteLength });
    const blob = new Blob([buf], { type: 'model/gltf-binary' });
    return URL.createObjectURL(blob);
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

  const blob = new Blob(chunks, { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}

// 設定 src 並「確定」載入完成（load 事件 + 下一幀）
function setModelSrcAndWait(objURL, ticket) {
  return new Promise((resolve, reject) => {
    const onLoad = async () => {
      if (ticket !== loadTicket) return; // 被取代
      await new Promise(r => requestAnimationFrame(r)); // 等一幀，避免覆蓋層搶在前面
      resolve();
      cleanup();
    };
    const onError = (e) => { cleanup(); reject(new Error('模型載入失敗')); };

    function cleanup() {
      mv.removeEventListener('load', onLoad);
      mv.removeEventListener('error', onError);
    }

    mv.addEventListener('load', onLoad, { once: true });
    mv.addEventListener('error', onError, { once: true });
    mv.setAttribute('crossorigin', 'anonymous');
    mv.src = objURL;
    mv.cameraOrbit = '0deg 75deg auto';
    mv.cameraTarget = 'auto auto auto';
    mv.cameraControls = true;
  });
}

// =================== UI helpers ===================

function beginOverlay(msg, pct) {
  updateOverlay(pct, msg);
  overlay.hidden = false;
}
function updateOverlay(pct, msg) {
  fillEl.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  pctEl.textContent = Number.isFinite(pct) ? `${pct}%` : '…';
  if (msg) msgEl.textContent = msg;
}
function endOverlayOK() {
  updateOverlay(100, '完成');
  setTimeout(() => { overlay.hidden = true; updateOverlay(0, ''); }, 250);
}
function showError(err) {
  overlay.hidden = false;
  updateOverlay(0, (err && err.message) ? `載入失敗：${err.message}` : '載入失敗，請檢查路徑或跨域 (CORS)');
}

// 分享按鈕狀態
function updateShare(src) {
  const hasRemote = !!src;
  shareBtn.disabled = !hasRemote;
  shareBtn.style.opacity = hasRemote ? 1 : 0.6;
}
function currentRemoteSrc() {
  const p = new URLSearchParams(location.search);
  return p.get('src') || '';
}

// -------- 離開頁面釋放資源 ----------
window.addEventListener('beforeunload', () => {
  if (localBlobURL) URL.revokeObjectURL(localBlobURL);
  if (remoteBlobURL) URL.revokeObjectURL(remoteBlobURL);
  if (fetchCtrl) fetchCtrl.abort();
});
