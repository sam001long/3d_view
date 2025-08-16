import '@google/model-viewer';

const mv = document.getElementById('mv');
const preset = document.getElementById('preset');
const glbInput = document.getElementById('glb');
const resetBtn = document.getElementById('reset');
const shareBtn = document.getElementById('share');

// 進度 UI 元素
const overlay = document.getElementById('progress');
const fillEl = document.getElementById('progressFill');
const pctEl = document.getElementById('progressPct');
const msgEl = document.getElementById('progressMsg');

let glbURL; // 本機檔的 blob URL
let connectTimer; // 顯示「連線中…」的延遲

// 讀取清單，填入下拉選單（public/models/manifest.json）
(async () => {
  try {
    const res = await fetch('models/manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest not found');
    const list = await res.json();
    for (const item of list) {
      const opt = document.createElement('option');
      opt.value = item.src;          // e.g. models/你的檔名.glb
      opt.textContent = item.label;  // 顯示名稱
      preset.appendChild(opt);
    }
  } catch {
    // 沒有 manifest.json 就略過；不影響上傳功能
  }

  // 若網址有 ?src=...，開頁時就直接載入
  const p = new URLSearchParams(location.search);
  if (p.get('src')) {
    loadFromURL(p.get('src'));
    // 幫選單選中相同項目（若有）
    [...preset.options].forEach(o => { if (o.value === p.get('src')) preset.value = o.value; });
  }
})();

// ====== 事件：ModelViewer 的載入進度 / 成功 / 失敗 ======
mv.addEventListener('progress', (e) => {
  const t = e.detail?.totalProgress ?? 0; // 0~1
  const pct = Math.max(0, Math.min(100, Math.round(t * 100)));
  showOverlay();
  setProgress(pct, '下載中…');
});

mv.addEventListener('load', () => {
  // 載入完成
  setProgress(100, '完成');
  setTimeout(hideOverlay, 250);
  clearTimeout(connectTimer);
});

mv.addEventListener('error', (e) => {
  // 失敗提示
  showOverlay();
  setProgress(0, '載入失敗，請檢查路徑或允許跨域 (CORS)');
  clearTimeout(connectTimer);
});

// ====== 下拉選單載入（遠端） ======
preset.addEventListener('change', () => {
  if (!preset.value) return;
  loadFromURL(preset.value);
  updateShare(preset.value);
});

// ====== 上傳本機 GLB（不會上傳到網路） ======
glbInput.onchange = () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
  const f = glbInput.files?.[0];
  if (!f) return;
  glbURL = URL.createObjectURL(f);

  // 本機檔通常很快，但仍顯示短暫「準備中」
  beginLoadingUI('準備讀取本機檔…');
  mv.setAttribute('crossorigin','anonymous');
  mv.src = glbURL;
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
  mv.cameraControls = true;
  preset.value = ""; // 清除選單選取
  updateShare("");   // 本機檔不產生分享連結
};

// ====== 重置視角 ======
resetBtn.onclick = () => {
  if (mv.resetTurntableRotation) mv.resetTurntableRotation();
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
};

// ====== 複製分享連結（基於目前載入的遠端 src） ======
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

// ====== 支援把檔案拖進頁面 ======
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const [file] = e.dataTransfer.files;
  if (!file) return;
  if (glbURL) URL.revokeObjectURL(glbURL);
  glbURL = URL.createObjectURL(file);
  beginLoadingUI('準備讀取本機檔…');
  mv.src = glbURL;
  preset.value = "";
  updateShare("");
});

// ====== helpers ======
function loadFromURL(src) {
  if (!src) return;
  const abs = new URL(src, location).href; // 支援相對路徑，如 models/a.glb
  beginLoadingUI('連線中…');
  mv.setAttribute('crossorigin','anonymous');
  mv.src = abs;

  // 更新網址（不重整）
  const u = new URL(location.href);
  u.searchParams.set('src', src);
  history.replaceState(null, '', u);
}

function updateShare(src) {
  const hasRemote = !!src;
  shareBtn.disabled = !hasRemote;
  shareBtn.style.opacity = hasRemote ? 1 : 0.6;
}

function currentRemoteSrc() {
  const p = new URLSearchParams(location.search);
  return p.get('src') || '';
}

// ---- 進度 UI 控制 ----
function beginLoadingUI(initialMsg = '準備下載…') {
  clearTimeout(connectTimer);
  showOverlay();
  setProgress(0, initialMsg);
  // 若 0.8s 內沒有 progress 事件，就顯示「連線中…」
  connectTimer = setTimeout(() => setProgress(0, '連線中…'), 800);
}
function showOverlay() {
  overlay.hidden = false;
}
function hideOverlay() {
  overlay.hidden = true;
  setProgress(0, ''); // 重置
}
function setProgress(pct, msg) {
  fillEl.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;
  if (msg) msgEl.textContent = msg;
}

// 釋放 blob URL
window.addEventListener('beforeunload', () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
});
