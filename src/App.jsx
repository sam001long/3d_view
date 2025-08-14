import React, { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, useHelper, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const deg2rad = (d) => (d * Math.PI) / 180;

const DISTANCE_SCALE = { CLOSE: 1.4, MEDIUM: 2.5, WIDE: 4.5 };
const ANGLE_MAP = { BIRD: 60, HIGH: 30, LEVEL: 0, LOW: -20 };

function computePose(t, { style, dist, elevDeg, speed, focus }) {
  const elev = deg2rad(elevDeg);
  const r = dist, y = r * Math.sin(elev), rh = Math.max(0.001, r * Math.cos(elev));
  const amp = Math.min(r * 0.35, focus.radius * 1.2);
  let x = rh, z = 0, phi = 0, ty = focus.center.y + focus.radius * 0.1;
  switch (style) {
    case "ORBIT": phi = t * speed; x = rh * Math.cos(phi); z = rh * Math.sin(phi); break;
    case "DOLLY": { const rr = r + amp * Math.sin(t * speed); const rrh = Math.max(0.001, rr * Math.cos(elev)); x = rrh; z = 0; break; }
    case "TRUCK": { const dx = amp * 0.6 * Math.sin(t * speed); x = rh + dx; z = 0; break; }
    case "CRANE": { const dy = amp * 0.6 * Math.sin(t * speed); x = rh; z = 0; return { position: [focus.center.x + x, ty + y + dy, focus.center.z + z], target: [focus.center.x, ty, focus.center.z] }; }
    case "STATIC": default: { x = rh; z = 0; phi = 0; break; }
  }
  return { position: [focus.center.x + x, ty + y, focus.center.z + z], target: [focus.center.x, ty, focus.center.z] };
}

function Ground() {
  return (<group>
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
      <planeGeometry args={[40, 40]} /><meshStandardMaterial color="#0b1220" />
    </mesh>
    <gridHelper args={[40, 40, "#334155", "#1f2937"]} position={[0, 0.001, 0]} />
    <axesHelper args={[1.2]} />
  </group>);
}

function DefaultSubject() {
  return (<group>
    <mesh castShadow position={[0, 0.8, 0]}><icosahedronGeometry args={[0.6, 1]} /><meshStandardMaterial metalness={0.1} roughness={0.4} color="#a3bffa" /></mesh>
    <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.35, 0.5, 0.5, 24]} /><meshStandardMaterial metalness={0.05} roughness={0.8} color="#64748b" /></mesh>
    <mesh castShadow position={[0, 0.0, 0]}><cylinderGeometry args={[0.6, 0.6, 0.1, 36]} /><meshStandardMaterial metalness={0.05} roughness={0.9} color="#94a3b8" /></mesh>
  </group>);
}

function useBlobURL(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (!file) { setUrl(null); return; } const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  return url;
}

function loadTextureFromFile(file, { colorSpace = THREE.NoColorSpace, flipY = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const url = URL.createObjectURL(file);
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => { tex.flipY = flipY; tex.colorSpace = colorSpace; tex.anisotropy = 4; resolve(tex); URL.revokeObjectURL(url); }, undefined, (err) => { reject(err); URL.revokeObjectURL(url); });
  });
}

function applyTextures(root, maps, { overrideExisting = true } = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = obj.material;
    if (!mat || Array.isArray(mat)) return;
    if (maps.baseColor) { if (overrideExisting || !mat.map) mat.map = maps.baseColor; mat.map && (mat.map.needsUpdate = true); }
    if (maps.normal) { if (overrideExisting || !mat.normalMap) mat.normalMap = maps.normal; mat.normalMap && (mat.normalMap.needsUpdate = true); }
    if (maps.orm) { if (overrideExisting || !mat.roughnessMap) mat.roughnessMap = maps.orm; if (overrideExisting || !mat.metalnessMap) mat.metalnessMap = maps.orm; if (overrideExisting || !mat.aoMap) mat.aoMap = maps.orm;
      mat.roughnessMap && (mat.roughnessMap.needsUpdate = true); mat.metalnessMap && (mat.metalnessMap.needsUpdate = true); mat.aoMap && (mat.aoMap.needsUpdate = true); }
    mat.needsUpdate = true;
  });
}

function useFocusFromObject(object3D) {
  const [focus, setFocus] = useState({ center: new THREE.Vector3(0, 0.45, 0), radius: 1.0, height: 1.2 });
  useEffect(() => {
    if (!object3D) return;
    const box = new THREE.Box3().setFromObject(object3D);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1.0;
    setFocus({ center, radius, height: size.y });
  }, [object3D]);
  return focus;
}

function GLBModel({ glbFile, maps, onLoaded }) {
  const url = useBlobURL(glbFile);
  const { scene } = useGLTF(url);
  useEffect(() => { if (scene && onLoaded) onLoaded(scene); }, [scene, onLoaded]);
  useEffect(() => { if (!scene) return; if (maps && (maps.baseColor || maps.normal || maps.orm)) { applyTextures(scene, maps, { overrideExisting: true }); } }, [scene, maps]);
  const groupRef = useRef();
  useEffect(() => { if (!scene || !groupRef.current) return; const box = new THREE.Box3().setFromObject(scene); const c = new THREE.Vector3(); box.getCenter(c); scene.position.sub(c); }, [scene]);
  return <group ref={groupRef}>{scene && <primitive object={scene} />}</group>;
}

function OmniscientView({ t, style, dist, elevDeg, speed, fov, focus, content }) {
  const shotCamRef = useRef();
  useFrame(() => {
    const pose = computePose(t, { style, dist, elevDeg, speed, focus });
    if (shotCamRef.current) { shotCamRef.current.fov = fov; shotCamRef.current.position.set(...pose.position); shotCamRef.current.lookAt(...pose.target); shotCamRef.current.updateProjectionMatrix(); }
  });
  useHelper(shotCamRef, THREE.CameraHelper, "#60a5fa");
  return (<Canvas shadows dpr={[1, 2]} camera={{ position: [6, 4, 6], fov: 55 }}>
    <color attach="background" args={["#020617"]} /><fog attach="fog" args={["#020617", 20, 60]} />
    <ambientLight intensity={0.55} /><directionalLight castShadow position={[6, 8, 4]} intensity={1.1} shadow-mapSize={[1024, 1024]}>
      <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.5, 50]} /></directionalLight>
    <Ground /><Suspense fallback={<DefaultSubject />}>{content}</Suspense>
    <PerspectiveCamera ref={shotCamRef} makeDefault={false} near={0.05} far={200} />
    <OrbitControls makeDefault enablePan enableZoom enableRotate />
  </Canvas>);
}

function CameraView({ t, style, dist, elevDeg, speed, fov, focus, content }) {
  const { camera } = useThree();
  useFrame(() => { const pose = computePose(t, { style, dist, elevDeg, speed, focus }); camera.fov = fov; camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateProjectionMatrix(); });
  return (<>
    <color attach="background" args={["#0b1020"]} />
    <ambientLight intensity={0.45} /><directionalLight position={[6, 8, 4]} intensity={1.0} />
    <Ground /><Suspense fallback={<DefaultSubject />}>{content}</Suspense>
  </>);
}

function Controls({ style, setStyle, distance, setDistance, angle, setAngle, fov, setFov, speed, setSpeed, playing, setPlaying }) {
  return (<div className="flex flex-wrap items-center gap-3">
    <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-slate-400">運鏡</span>
      <select className="bg-slate-800 text-slate-100 rounded-xl px-3 py-2 text-sm border border-slate-700" value={style} onChange={(e) => setStyle(e.target.value)}>
        <option value="STATIC">靜態</option><option value="ORBIT">環繞（Arc/Orbit）</option><option value="DOLLY">推軌（Dolly）</option><option value="TRUCK">橫移（Truck）</option><option value="CRANE">搖臂（Crane）</option>
      </select></div>
    <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-slate-400">距離</span>
      <div className="flex items-center gap-1 bg-slate-800 rounded-xl p-1 border border-slate-700">
        {[{ label: "CLOSE-SHOT", key: "CLOSE" },{ label: "MEDIUM", key: "MEDIUM" },{ label: "WIDER-SHOT", key: "WIDE" }].map((opt) => (
          <button key={opt.key} onClick={() => setDistance(opt.key)} className={`px-3 py-1.5 text-xs rounded-lg transition ${distance === opt.key ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-700"}`}>{opt.label}</button>
        ))}
      </div></div>
    <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-slate-400">角度</span>
      <select className="bg-slate-800 text-slate-100 rounded-xl px-3 py-2 text-sm border border-slate-700" value={angle} onChange={(e) => setAngle(e.target.value)}>
        <option value="BIRD">鳥瞰</option><option value="HIGH">高角度</option><option value="LEVEL">水平</option><option value="LOW">低角度</option>
      </select></div>
    <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-slate-400">FOV</span>
      <input type="range" min={20} max={85} value={fov} onChange={(e) => setFov(parseFloat(e.target.value))} />
      <span className="text-slate-300 text-sm w-10 text-right">{Math.round(fov)}°</span></div>
    <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-wider text-slate-400">速度</span>
      <input type="range" min={0.2} max={2.5} step={0.1} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
      <span className="text-slate-300 text-sm w-10 text-right">{speed.toFixed(1)}x</span></div>
    <div className="ml-auto flex items-center gap-2"><button onClick={() => setPlaying((p) => !p)} className="px-3 py-2 text-sm rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow">{playing ? "暫停" : "播放"}</button></div>
  </div>);
}

function Uploader({ onGLB, onMapChange }) {
  const handleGLB = (e) => onGLB && onGLB(e.target.files?.[0] || null);
  const handleMap = async (kind, e) => {
    const file = e.target.files?.[0];
    if (!file) return onMapChange && onMapChange(kind, null);
    const opts = kind === "baseColor" ? { colorSpace: THREE.SRGBColorSpace, flipY: false } : { colorSpace: THREE.NoColorSpace, flipY: false };
    const tex = await loadTextureFromFile(file, opts);
    onMapChange && onMapChange(kind, tex);
  };
  return (<div className="space-y-3">
    <div className="text-xs text-slate-400">上傳 GLB 與貼圖（可選）：BaseColor、Normal、ORM（R=AO, G=Roughness, B=Metallic）</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-sm">GLB 檔<input className="bg-slate-900 border border-slate-700 rounded p-2" type="file" accept=".glb,.gltf" onChange={handleGLB} /></label>
      <label className="flex flex-col gap-1 text-sm">BaseColor（sRGB）<input className="bg-slate-900 border border-slate-700 rounded p-2" type="file" accept="image/*" onChange={(e)=>handleMap("baseColor", e)} /></label>
      <label className="flex flex-col gap-1 text-sm">Normal<input className="bg-slate-900 border border-slate-700 rounded p-2" type="file" accept="image/*" onChange={(e)=>handleMap("normal", e)} /></label>
      <label className="flex flex-col gap-1 text-sm">ORM（AO/Rough/Metal）<input className="bg-slate-900 border border-slate-700 rounded p-2" type="file" accept="image/*" onChange={(e)=>handleMap("orm", e)} /></label>
    </div>
    <div className="text-[10px] text-slate-500">註：GLB 若已內嵌貼圖，可不另外上傳。貼圖/GLB 僅在瀏覽器端讀取，不會上傳。</div>
  </div>);
}

export default function App() {
  const [style, setStyle] = useState("ORBIT");
  const [distance, setDistance] = useState("MEDIUM");
  const [angle, setAngle] = useState("LEVEL");
  const [fov, setFov] = useState(50);
  const [speed, setSpeed] = useState(0.8);
  const [playing, setPlaying] = useState(true);

  const [glbFile, setGlbFile] = useState(null);
  const [maps, setMaps] = useState({ baseColor: null, normal: null, orm: null });

  const [t, setT] = useState(0);
  useEffect(() => { let raf; let last = performance.now(); const loop = (now) => { const dt = (now - last) / 1000; last = now; if (playing) setT((v) => v + dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, [playing]);

  const [lastScene, setLastScene] = useState(null);
  const focus = useFocusFromObject(lastScene);

  const dist = Math.max(0.5, DISTANCE_SCALE[distance] * Math.max(1.0, focus.radius * 2.0));
  const elevDeg = ANGLE_MAP[angle];

  const content = glbFile ? (<GLBModel glbFile={glbFile} maps={maps} onLoaded={setLastScene} />) : (<DefaultSubject />);

  return (<div className="min-h-screen w-full bg-slate-950 text-slate-100 p-5">
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">3D 運鏡模擬器</h1>
          <p className="text-slate-400 text-sm">上傳 GLB + 貼圖，並同時預覽 3D 全知視角與 2D 取景。</p></div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm space-y-4">
        <Controls style={style} setStyle={setStyle} distance={distance} setDistance={setDistance} angle={angle} setAngle={setAngle} fov={fov} setFov={setFov} speed={speed} setSpeed={setSpeed} playing={playing} setPlaying={setPlaying} />
        <Uploader onGLB={setGlbFile} onMapChange={(kind, tex)=> setMaps((m)=>({ ...m, [kind]: tex }))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="relative rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 shadow overflow-hidden">
          <div className="absolute z-10 left-3 top-3 text-xs bg-black/40 px-2 py-1 rounded">3D 全知視角</div>
          <OmniscientView t={t} style={style} dist={dist} elevDeg={elevDeg} speed={speed} fov={fov} focus={focus} content={content} />
        </div>

        <div className="relative rounded-2xl border border-slate-800 bg-slate-900 shadow overflow-hidden">
          <div className="absolute z-10 left-3 top-3 text-xs bg-black/40 px-2 py-1 rounded">2D 鏡頭視角</div>
          <div className="aspect-[16/9] w-full">
            <Canvas shadows dpr={[1, 2]} camera={{ position: [3, 2, 3], fov }}>
              <CameraView t={t} style={style} dist={dist} elevDeg={elevDeg} speed={speed} fov={fov} focus={focus} content={content} />
            </Canvas>
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="border-slate-600/30" style={{ borderRightWidth: i % 3 === 2 ? 0 : 1, borderBottomWidth: i < 6 ? 1 : 0 }} />
                ))}
              </div>
              <div className="absolute inset-3 border border-white/20 rounded"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 space-y-1">
        <p>提示：距離採相對模型尺度自動換算；FOV 影響視角，與距離搭配可模擬（遠距+長焦 / 近距+廣角）。</p>
        <p>貼圖：BaseColor/Emissive 用 sRGB；Normal/AO/Rough/Metal 用 Linear。ORM 圖同時套 Roughness/Metalness/AO。</p>
      </div>
    </div>
  </div>);
}
