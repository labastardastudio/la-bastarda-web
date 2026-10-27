/* ===================== BOX IN REAL 3D =====================
   The tray (while choosing) and the box in «Revisar» drawn with WebGL. Each cookie is made from its photo:
   the top photo (or the centre of the main photo) is cut out, a height map is taken from it and it becomes a lit,
   round surface. Height in cm per flavour, from the panel. Without WebGL the CSS box stays as it was. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const L = window.LB3;
// units: centimetres. Inside 30 × 20 (6) or 20 × 20 (4), walls 4 cm, card 0.25 cm
const WALL = 4, CARD = .25, CK = 9.2;
const ROT = [0, 1.9, 3.6, .8, 2.7, 4.4];
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

// ---- shared materials and cookie shapes (the same for every view) ----
const grain = (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), d = x.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) { const v = 236 + Math.random() * 19; d.data[i] = v; d.data[i + 1] = v - 2; d.data[i + 2] = v - 6; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const cardOut = new THREE.MeshStandardMaterial({ color: 0xE4DCCB, map: grain, roughness: .92 });
const cardIn = new THREE.MeshStandardMaterial({ color: 0xF1ECE2, map: grain, roughness: .95 });
const paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .55, transparent: true, opacity: .62 });

function frontPrint(w, n) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = Math.round(1024 * WALL / w);
  const x = c.getContext("2d"); x.fillStyle = "#1A1916"; x.textBaseline = "middle";
  x.font = `italic 400 ${c.height * .42}px Newsreader, Georgia, serif`; x.fillText("La Bastarda", c.width * .05, c.height * .52);
  x.font = `500 ${c.height * .16}px "Hanken Grotesk", Arial, sans-serif`; x.textAlign = "right";
  x.fillText("C O O K I E S   ·   " + n, c.width * .95, c.height * .54);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, WALL), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: .9 }));
}
function buildBox(n) {
  const W = n === 6 ? 30 : 20, D = 20, g = new THREE.Group(), r = .1;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); };
  add(new RoundedBoxGeometry(W + 2 * CARD, CARD, D + 2 * CARD, 3, r), cardIn, 0, -CARD / 2, 0);
  add(new RoundedBoxGeometry(W + 2 * CARD, WALL, CARD, 3, r), cardOut, 0, WALL / 2 - CARD / 2, -D / 2 - CARD / 2);
  add(new RoundedBoxGeometry(W + 2 * CARD, WALL, CARD, 3, r), cardOut, 0, WALL / 2 - CARD / 2, D / 2 + CARD / 2);
  add(new RoundedBoxGeometry(CARD, WALL, D, 3, r * .8), cardOut, -W / 2 - CARD / 2, WALL / 2 - CARD / 2, 0);
  add(new RoundedBoxGeometry(CARD, WALL, D, 3, r * .8), cardOut, W / 2 + CARD / 2, WALL / 2 - CARD / 2, 0);
  const p = frontPrint(W, n); p.position.set(0, WALL / 2 - CARD / 2, D / 2 + CARD + .01); g.add(p);
  // a square of baking paper in every place, so an empty box already shows where the cookies go
  slotXZ(n).forEach(([x, z], i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 9.8), paperMat); m.rotation.set(-Math.PI / 2, 0, [.04, -.06, .03, -.03, .05, -.04][i]); m.position.set(x, .02, z); m.receiveShadow = true; g.add(m); });
  return g;
}
const slotXZ = n => { const W = n === 6 ? 30 : 20, cols = n === 6 ? 3 : 2; return Array.from({ length: n }, (_, i) => [((i % cols) - (cols - 1) / 2) * (W / cols), (Math.floor(i / cols) - .5) * 10]); };

// The photo only shows the top. Where the surface turns steep (the sides), the photo is projected from the side,
// so the crumb keeps its real size instead of being stretched into lines.
function cookieMat(tex, h) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .78, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uH = { value: h };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLoc = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;\nuniform float uH;")
      .replace("#include <map_fragment>", `#include <map_fragment>
      {
        vec3 gn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        vec3 up = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);
        float steep = smoothstep(.35, .75, 1. - abs(dot(gn, up)));
        float hy = vLoc.y * uH / ${CK.toFixed(1)};
        vec2 ux = vec2(vLoc.z / ${CK.toFixed(1)} + .5, .62 - hy), uz = vec2(vLoc.x / ${CK.toFixed(1)} + .5, .62 - hy);
        float wx = abs(vLoc.x) / (abs(vLoc.x) + abs(vLoc.z) + 1e-4);
        vec4 side = mix(texture2D(map, uz), texture2D(map, ux), smoothstep(.3, .7, wx));
        side.rgb *= .86 + .14 * smoothstep(0., .6, vLoc.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, side.rgb, steep);
      }`);
  };
  return mat;
}
// a round mesh (rings around the centre), so the outline is smooth with no pixel steps
function cookieGeo(H, S) {
  const v = q => Math.max(0, H[q]);
  const h = (x, y) => { x = Math.min(S - 1.001, Math.max(0, x)); y = Math.min(S - 1.001, Math.max(0, y));
    const i = x | 0, j = y | 0, fx = x - i, fy = y - j, p = j * S + i;
    return (v(p) * (1 - fx) + v(p + 1) * fx) * (1 - fy) + (v(p + S) * (1 - fx) + v(p + S + 1) * fx) * fy; };
  let cx = 0, cy = 0, c = 0; for (let p = 0; p < S * S; p++) if (H[p] >= 0) { cx += p % S; cy += (p / S) | 0; c++; } cx /= c; cy /= c;
  const A = 200, K = 70, R0 = new Float32Array(A), R = new Float32Array(A), TAPER = 7 * S / 256, IN = 2.5 * S / 256;
  for (let a = 0; a < A; a++) { const th = a / A * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th); let r = 0;
    for (let s = 0; s < S; s += .25) { const x = Math.round(cx + dx * s), y = Math.round(cy + dy * s); if (x < 0 || y < 0 || x >= S || y >= S || H[y * S + x] < 0) break; r = s; } R0[a] = r; }
  for (let a = 0; a < A; a++) { let s = 0; for (let k = -3; k <= 3; k++) s += R0[(a + k + A) % A]; R[a] = s / 7 - .4; }
  const n = 1 + A * K, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  const put = (q, x, y, ht) => { pos[q * 3] = (x / (S - 1) - .5) * CK; pos[q * 3 + 2] = (y / (S - 1) - .5) * CK; pos[q * 3 + 1] = ht; uv[q * 2] = x / (S - 1); uv[q * 2 + 1] = 1 - y / (S - 1); };
  put(0, cx, cy, h(cx, cy));
  for (let k = 1; k <= K; k++) { const rho = 1 - Math.pow(1 - k / K, 1.6);
    for (let a = 0; a < A; a++) { const th = a / A * Math.PI * 2, r = R[a] * rho, d = R[a] - r, t = Math.min(1, d / TAPER), ri = Math.min(r, R[a] - IN);
      put(1 + (k - 1) * A + a, cx + Math.cos(th) * r, cy + Math.sin(th) * r, k === K ? 0 : h(cx + Math.cos(th) * ri, cy + Math.sin(th) * ri) * Math.sqrt(t * (2 - t)) * (.35 + .65 * t)); } }
  for (let a = 0; a < A; a++) idx.push(0, 1 + (a + 1) % A, 1 + a);
  for (let k = 1; k < K; k++) for (let a = 0; a < A; a++) { const p0 = 1 + (k - 1) * A, p1 = p0 + A, b = (a + 1) % A; idx.push(p0 + a, p0 + b, p1 + a, p0 + b, p1 + b, p1 + a); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// texture: the photo, with the edge softened where it will be seen side-on
function cookieTex(px, H, S) {
  const c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d"), d = x.createImageData(S, S);
  const N = S * S, sm = new Float32Array(N * 3), r = Math.round(9 * S / 256);
  for (let k = 0; k < 3; k++) { const a = new Float32Array(N), b = new Float32Array(N);
    for (let p = 0; p < N; p++) a[p] = H[p] >= 0 ? px[p * 4 + k] : -1;
    for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) { let s = 0, c2 = 0; for (let i = -r; i <= r; i++) { const v = a[y * S + Math.min(S - 1, Math.max(0, xx + i))]; if (v >= 0) s += v, c2++; } b[y * S + xx] = c2 ? s / c2 : 0; }
    for (let xx = 0; xx < S; xx++) for (let y = 0; y < S; y++) { let s = 0, c2 = 0; for (let i = -r; i <= r; i++) { const q = Math.min(S - 1, Math.max(0, y + i)) * S + xx; if (a[q] >= 0) s += b[q], c2++; } sm[(y * S + xx) * 3 + k] = c2 ? s / c2 : 0; } }
  const hh = q => H[q] >= 0 ? H[q] : 0, step = 9.2 / S;
  for (let p = 0; p < N; p++) { const xx = p % S, y = (p / S) | 0;
    const g = H[p] < 0 ? 0 : Math.hypot(hh(y * S + Math.min(S - 1, xx + 1)) - hh(y * S + Math.max(0, xx - 1)), hh(Math.min(S - 1, y + 1) * S + xx) - hh(Math.max(0, y - 1) * S + xx)) * 2.5 / (2 * step);
    const e = Math.min(1, H[p] < 0 ? 1 : H[p] / .3) / (1 + g * g * .5), w = e * e * (3 - 2 * e), shade = .84 + .16 * w;
    for (let k = 0; k < 3; k++) d.data[p * 4 + k] = Math.min(255, (px[p * 4 + k] * w + sm[p * 3 + k] * (1 - w)) * shade * 1.06 + 4); d.data[p * 4 + 3] = 255; }
  x.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const SHAPES = {};
// a flavour still without a photo: a plain round cookie, so the place is not empty (no invented look)
let plain = null;
function plainShape() {
  if (plain) return plain;
  const S = 128, H = new Float32Array(S * S), px = new Uint8ClampedArray(S * S * 4);
  for (let p = 0; p < S * S; p++) { const x = (p % S) / (S - 1) * 2 - 1, y = ((p / S) | 0) / (S - 1) * 2 - 1, r = Math.hypot(x, y) / .82;
    H[p] = r < 1 ? Math.sqrt(1 - Math.pow(r, 4)) * .9 : -1; px[p * 4] = 217; px[p * 4 + 1] = 219; px[p * 4 + 2] = 196; px[p * 4 + 3] = 255; }
  return plain = { geo: cookieGeo(H, S), tex: cookieTex(px, H, S) };
}
function shape(f) {
  if (!f.top && !f.img) return Promise.resolve(plainShape());
  const src = L.imgSrc(f.top || f.img), round = !f.top, key = src + "|" + round;
  return SHAPES[key] || (SHAPES[key] = L.rlfLoad(src).then(img => {
    if (!img) return null;
    const m = L.rlfMask(img, round), S = L.RLF.size, H = L.rlfHeight(m.px, m.A);
    return { geo: cookieGeo(H, S), tex: cookieTex(m.px, H, S) };
  }));
}
function cookieMesh(sh, f) {
  const h = f.h || 2.2, m = new THREE.Mesh(sh.geo, cookieMat(sh.tex, h));
  m.scale.y = h; m.castShadow = m.receiveShadow = true; return m;
}

// ---- one view: a canvas with its own light, camera and box ----
function view(host, { orbit, polar }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .55;
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xd9d0bf, .9));
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.4); sun.position.set(-26, 52, 30); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 140 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; sun.shadow.radius = 4; scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: .16 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -CARD; ground.receiveShadow = true; scene.add(ground);
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 1000);
  const cv = renderer.domElement; cv.className = "b3"; cv.setAttribute("aria-hidden", "true"); host.append(cv);

  let n = 0, boxG = null, base = 80, raf = 0, until = 0, hover = -1;
  const slots = [];       // { sku, mesh, y, vy, lift }
  const target = new THREE.Vector3(0, 1.2, 0);
  const controls = orbit ? new OrbitControls(camera, cv) : null;
  if (controls) { Object.assign(controls, { enableDamping: true, dampingFactor: .08, enablePan: false, minPolarAngle: .12, maxPolarAngle: 1.3, rotateSpeed: .8 }); controls.target.copy(target); }

  // distance at which the whole box (walls included) fits the canvas from the starting angle
  function fit() {
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const W = (n === 6 ? 30 : 20) / 2 + CARD, D = 10 + CARD, pts = [];
    for (const x of [-W, W]) for (const y of [-CARD, WALL]) for (const z of [-D, D]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 10, hi = 400;
    for (let k = 0; k < 30; k++) { const d = (lo + hi) / 2; place(polar, 0, d); camera.updateMatrixWorld();
      const ok = pts.every(p => { const q = p.clone().project(camera); return Math.abs(q.x) < .88 && Math.abs(q.y) < .86; }); ok ? hi = d : lo = d; }
    base = hi; if (controls) { controls.minDistance = base * .78; controls.maxDistance = base * 1.35; }
  }
  function place(pol, az, d) { camera.position.set(Math.sin(pol) * Math.sin(az) * d, Math.cos(pol) * d, Math.sin(pol) * Math.cos(az) * d).add(target); camera.lookAt(target); }
  function home() { place(polar, 0, base); controls && controls.update(); wake(); }

  function frame() {
    let busy = controls ? controls.update() : false;
    for (const [i, s] of slots.entries()) { if (!s) continue;
      // falling in, then settling; a lifted cookie is the one under the pointer or in focus
      if (s.y > 0 || s.vy) { s.vy -= .045; s.y += s.vy; if (s.y <= 0) { s.y = 0; s.vy = Math.abs(s.vy) > .12 ? -s.vy * .28 : 0; } busy = true; }
      const want = i === hover ? .7 : 0; if (Math.abs(s.lift - want) > .005) { s.lift += (want - s.lift) * .25; busy = true; } else s.lift = want;
      s.mesh.position.y = .04 + s.y + s.lift; }
    renderer.render(scene, camera);
    raf = busy || performance.now() < until ? requestAnimationFrame(frame) : 0;
  }
  function wake(ms = 300) { until = Math.max(until, performance.now() + ms); if (!raf) raf = requestAnimationFrame(frame); }
  if (controls) { controls.addEventListener("start", () => wake(1e9)); controls.addEventListener("end", () => { until = 0; wake(1200); }); controls.addEventListener("change", () => wake()); }
  const ro = new ResizeObserver(() => { fit(); orbit ? wake() : home(); }); ro.observe(host); ro.observe(cv);

  // what is in the box: keep the cookies that did not move, drop in the new ones
  async function set(size, sel, animate) {
    if (size !== n) { n = size; if (boxG) scene.remove(boxG); boxG = buildBox(n); scene.add(boxG); slots.forEach(s => s && scene.remove(s.mesh)); slots.length = 0; fit(); home(); }
    const xz = slotXZ(n);
    for (let i = 0; i < n; i++) {
      const sku = sel[i], cur = slots[i];
      if (cur && cur.sku === sku) continue;
      if (cur) { scene.remove(cur.mesh); slots[i] = null; }
      if (!sku) continue;
      const f = L.bySku(sku), sh = f && await shape(f);
      if (!sh || sel[i] !== sku || slots[i]) continue;
      const m = cookieMesh(sh, f); m.position.set(xz[i][0], .04, xz[i][1]); m.rotation.y = ROT[i]; m.userData.i = i;
      slots[i] = { sku, mesh: m, y: animate && !reduce.matches ? 9 : 0, vy: 0, lift: 0 }; scene.add(m);
    }
    for (let i = n; i < slots.length; i++) slots[i] && scene.remove(slots[i].mesh);
    wake(600);
  }
  // which cookie is under the pointer
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = cv.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(slots.filter(Boolean).map(s => s.mesh))[0];
    return hit ? hit.object.userData.i : -1;
  }
  function setHover(i) { if (i !== hover) { hover = i; wake(); } }
  function nudge([dt, dp]) { const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target)); s.theta += dt; s.phi = Math.min(1.3, Math.max(.12, s.phi - dp));
    camera.position.copy(new THREE.Vector3().setFromSpherical(s).add(target)); camera.lookAt(target); wake(); }
  return { set, home, pick, setHover, cv, nudge, moved: () => controls && camera.position.distanceTo(new THREE.Vector3(Math.sin(polar) * 0, Math.cos(polar) * base, Math.sin(polar) * base).add(target)) > .5 };
}

// ---- the tray, on wide screens ----
let tray = null;
function trayView() {
  if (tray) return tray;
  const wrap = document.querySelector(".slots3"), slotsEl = document.getElementById("slots");
  tray = view(wrap, { orbit: false, polar: .66 });
  wrap.classList.add("gl");
  tray.cv.addEventListener("pointermove", e => { const i = tray.pick(e); tray.setHover(i); tray.cv.style.cursor = i < 0 ? "" : "pointer"; });
  tray.cv.addEventListener("pointerleave", () => tray.setHover(-1));
  tray.cv.addEventListener("click", e => { const i = tray.pick(e); if (i < 0) return; tray.setHover(-1); slotsEl.querySelector(`.slot.full[data-i="${i}"]`)?.click(); });
  // keyboard: the slot buttons stay in the page (hidden under the canvas); the one in focus lifts its cookie
  slotsEl.addEventListener("focusin", e => { const s = e.target.closest(".slot.full"); tray.setHover(s ? +s.dataset.i : -1); });
  slotsEl.addEventListener("focusout", () => tray.setHover(-1));
  return tray;
}
// on phones the tray is a row of small discs: each one shows the 3D cookie, drawn once per flavour
let spr = null; const SPR = {};
// disc: the small circles of the phone tray; card: the 4:5 picture of each flavour in the list
const KINDS = { disc: [160, 160, [0, 26, 12], 22], card: [480, 600, [0, 23, 18.5], 24] };
function sprite(f, kind = "disc") {
  const key = f.sku + "|" + kind;
  return SPR[key] || (SPR[key] = shape(f).then(sh => {
    if (!sh) return null;
    if (!spr) { const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      const sc = new THREE.Scene(); sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), .04).texture; sc.environmentIntensity = .55;
      sc.add(new THREE.HemisphereLight(0xfffaf0, 0xd9d0bf, .9));
      const sun = new THREE.DirectionalLight(0xfff4e2, 2.4); sun.position.set(-14, 30, 16); sun.castShadow = true;
      Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 5, far: 80 }); sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 6; sun.shadow.bias = -.0004; sc.add(sun);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: .18 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; sc.add(g);
      spr = { r, sc, cam: new THREE.PerspectiveCamera(22, 1, 1, 200) }; }
    const [w, h, pos, fov] = KINDS[kind]; spr.r.setSize(w, h, false);
    Object.assign(spr.cam, { fov, aspect: w / h }); spr.cam.updateProjectionMatrix(); spr.cam.position.set(...pos); spr.cam.lookAt(0, .8, 0);
    const m = cookieMesh(sh, f); m.rotation.y = .6; spr.sc.add(m); spr.r.render(spr.sc, spr.cam); const url = spr.r.domElement.toDataURL("image/png"); spr.sc.remove(m); return url;
  }));
}
// the list of flavours and the summary in «Revisar»: the cookie with volume in place of the photo
function listThumbs() {
  document.querySelectorAll("#flavours .fl").forEach(li => { const f = L.bySku(li.dataset.sku), im = li.querySelector(".ph2 img"); if (!f || !im) return;
    sprite(f, "card").then(url => { if (url && im.isConnected) { im.src = url; im.closest(".ph2").classList.add("b3c"); } }); });
  document.querySelectorAll("#sum li[data-sku]").forEach(li => { const f = L.bySku(li.dataset.sku), im = li.querySelector(".th img"); if (!f || !im) return;
    sprite(f, "card").then(url => { if (url && im.isConnected) { im.src = url; im.closest(".th").classList.add("b3c"); } }); });
}
function phoneDiscs() {
  document.querySelectorAll("#slots .slot.full").forEach(s => { const f = L.bySku(L.box.sel[+s.dataset.i]); if (!f) return;
    sprite(f).then(url => { if (!url || !s.isConnected) return; const fl = s.querySelector(".c3d"); if (!fl) return;
      fl.innerHTML = `<span class="flat b3s"><img src="${url}" alt=""></span>`; }); });
}
let lastSel = "";
function syncTray() {
  const wide = matchMedia("(min-width:900px)").matches;
  document.querySelector(".slots3")?.classList.toggle("gl", wide);
  if (!wide) { phoneDiscs(); return; }
  const b = L.box, k = b.size + ":" + b.sel.join(",");
  trayView().set(b.size, b.sel.slice(), lastSel !== "" && b.sel.length > (lastSel.split(":")[1] || "").split(",").filter(Boolean).length);
  lastSel = k;
}

// ---- «Revisar»: the same box, to turn and look at ----
let rev = null;
function syncReview() {
  const wrap = document.getElementById("shBox3"), reset = document.getElementById("shTurnReset");
  if (!rev) {
    rev = view(wrap, { orbit: true, polar: .82 }); wrap.classList.add("gl");
    const upd = () => { reset.hidden = !rev.moved(); };
    rev.cv.addEventListener("pointerup", () => setTimeout(upd, 900)); rev.cv.addEventListener("wheel", () => setTimeout(upd, 300));
    wrap.addEventListener("keydown", e => { const d = { ArrowLeft: [.18, 0], ArrowRight: [-.18, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] }[e.key]; if (!d) return; e.preventDefault(); rev.nudge(d); upd(); });
    reset.addEventListener("click", () => { rev.home(); reset.hidden = true; });
  }
  rev.set(L.box.size, L.box.sel.slice(), false).then(() => { rev.home(); reset.hidden = true; });
}

// probe WebGL once; without it nothing changes
const ok = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
if (ok && L) {
  window.B3 = { tray: syncTray, review: syncReview, list: listThumbs };
  listThumbs();
  addEventListener("resize", () => syncTray());
  syncTray();
  if (!document.getElementById("sheet")?.hidden && document.querySelector('#sheet .sh-pane[data-pane="0"]:not([hidden])')) syncReview();
}
