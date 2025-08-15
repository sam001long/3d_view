import '@google/model-viewer';

const mv = document.getElementById('mv');
const preset = document.getElementById('preset');
const glbInput = document.getElementById('glb');
const resetBtn = document.getElementById('reset');
const shareBtn = document.getElementById('share');

let glbURL; // 本機檔的 blob URL

// 1) 讀取清單，填入下拉選單（public/models/manifest.json）
(async () => {
  try {
    const res = await fetch('models/manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest not found');
    const list = await res.json();
    for (const item of list) {
      const opt = document.createElement('option');
      opt.value = item.src;
      opt.textContent = item.label;
      preset.appendChild(opt);
    }
  } catch {
    // 若沒有 manifest.json，選單就留著空的，不影響上傳功能
  }

  // 若網址有 ?src=...，開頁時就直接載入
  const p = new URLSearchParams(location.search);
  if (p.get('src')) {
    loadFromURL(p.get('src'));
    // 若剛好在選單內，幫你選中
    [...preset.options].forEach(o => { if (o.value === p.get('src')) preset.value = o.value; });
  }
})();

// 2) 下拉選單載入
preset.addEventListener('change', () => {
  if (!preset.value) return;
  loadFromURL(preset.value);
  updateShare(preset.value);
});

// 3) 上傳本機 GLB（不會上傳到網路）
glbInput.onchange = () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
  const f = glbInput.files?.[0];
  if (!f) return;
  glbURL = URL.createObjectURL(f);
  mv.setAttribute('crossorigin','anonymous');
  mv.src = glbURL;
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
  mv.cameraControls = true;
  preset.value = ""; // 清除選單選取
  updateShare("");   // 本機檔不產生分享連結
};

// 4) 重置視角
resetBtn.onclick = () => {
  if (mv.resetTurntableRotation) mv.resetTurntableRotation();
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
};

// 5) 複製分享連結（基於目前載入的遠端 src）
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

// ---- helpers ----
function loadFromURL(src) {
  if (!src) return;
  const abs = new URL(src, location).href; // 支援相對路徑，如 models/a.glb
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

// 支援把檔案拖進頁面
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const [file] = e.dataTransfer.files;
  if (!file) return;
  if (glbURL) URL.revokeObjectURL(glbURL);
  glbURL = URL.createObjectURL(file);
  mv.src = glbURL;
  preset.value = "";
  updateShare("");
});

// 釋放 blob URL
window.addEventListener('beforeunload', () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
});
