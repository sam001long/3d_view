import '@google/model-viewer';

const mv = document.getElementById('mv');
const glbInput = document.getElementById('glb');
const usdzInput = document.getElementById('usdz');
const resetBtn = document.getElementById('reset');

let glbURL, usdzURL;

glbInput.onchange = () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
  const f = glbInput.files?.[0];
  if (!f) return;
  glbURL = URL.createObjectURL(f);
  mv.src = glbURL;                      // 顯示 3D（支援手勢旋轉/縮放/平移）
  mv.cameraOrbit = '0deg 75deg auto';   // 給個舒服的初始角度
  mv.cameraTarget = 'auto auto auto';
  mv.cameraControls = true;
};

usdzInput.onchange = () => {
  if (usdzURL) URL.revokeObjectURL(usdzURL);
  const f = usdzInput.files?.[0];
  if (!f) { mv.removeAttribute('ios-src'); return; }
  usdzURL = URL.createObjectURL(f);
  mv.setAttribute('ios-src', usdzURL);  // iPhone AR Quick Look 用
};

resetBtn.onclick = () => {
  // 重置視角到預設
  if (mv.resetTurntableRotation) mv.resetTurntableRotation();
  mv.cameraOrbit = '0deg 75deg auto';
  mv.cameraTarget = 'auto auto auto';
};

// 離開頁面前釋放本機 URL
window.addEventListener('beforeunload', () => {
  if (glbURL) URL.revokeObjectURL(glbURL);
  if (usdzURL) URL.revokeObjectURL(usdzURL);
});
