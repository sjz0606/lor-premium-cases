// WebGL reel: coverflow (desktop, horizontal, floor reflection) / vertical swipe stack (mobile)
// Real video planes; active plane dissolves from poster to live video via shader.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const VERT = /* glsl */`
uniform float uBend;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  p.z += sin(uv.x * 3.14159) * uBend * 0.12 + sin(uv.y * 3.14159) * abs(uBend) * 0.04;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D uTex; uniform sampler2D uVid;
uniform float uMix; uniform float uDim; uniform float uRefl; uniform float uAspect; uniform float uTime; uniform float uLoaded;
uniform vec3 uBg; uniform vec3 uGlow;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float sdRound(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  vec2 uv = vUv;
  vec3 a = texture2D(uTex, uv).rgb;
  vec3 col = mix(uBg * 0.93, a, uLoaded);
  if (uMix > 0.001) {
    vec3 b = texture2D(uVid, uv).rgb;
    float n = noise(uv * vec2(5.0, 9.0) + uTime * 0.15) * 0.55 + (1.0 - uv.y) * 0.45;
    float t = uMix * 1.2 - 0.1;
    float m = smoothstep(n - 0.05, n + 0.05, t);
    float edge = smoothstep(n - 0.07, n, t) - smoothstep(n, n + 0.07, t);
    col = mix(col, b, m) + uGlow * edge * 0.9;
  }
  col = mix(col, uBg, uDim);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float d = sdRound(p, vec2(uAspect * 0.5, 0.5), 0.032);
  float alpha = 1.0 - smoothstep(-0.002, 0.002, d);
  if (uRefl > 0.5) { alpha *= (1.0 - smoothstep(0.0, 0.42, uv.y)) * 0.2; }
  gl_FragColor = vec4(col, alpha);
}`;

export function createReel(host, opts) {
  const test = document.createElement('canvas');
  const gl = test.getContext('webgl2') || test.getContext('webgl');
  if (!gl) throw new Error('no webgl');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const H = 1, W = 9 / 16;
  const geo = new THREE.PlaneGeometry(W, H, 24, 24);
  const loader = new THREE.TextureLoader();
  const bg = new THREE.Vector3(0xEE / 255, 0xF3 / 255, 0xF5 / 255);
  const glow = new THREE.Vector3(0x3C / 255, 0xCF / 255, 0xDB / 255);
  const blank = new THREE.DataTexture(new Uint8Array([230, 236, 239, 255]), 1, 1); blank.needsUpdate = true;

  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.loop = true; video.preload = 'none';
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
  host.appendChild(video);
  const vtex = new THREE.VideoTexture(video); vtex.colorSpace = THREE.NoColorSpace;

  let axis = opts.axis || 'x';
  let items = [], nodes = [];
  let pos = 0, target = 0, vel = 0, active = -1, videoFor = -1, mixT = 0;
  let running = true, visible = true, raf = 0, last = performance.now(), t0 = last;
  const texCache = new Map();

  function makeMat(refl) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTex: { value: blank }, uVid: { value: vtex }, uMix: { value: 0 }, uDim: { value: 0 }, uRefl: { value: refl ? 1 : 0 },
        uAspect: { value: W / H }, uTime: { value: 0 }, uLoaded: { value: 0 }, uBg: { value: bg }, uGlow: { value: glow }, uBend: { value: 0 } },
    });
  }
  function tex(url, cb) {
    if (texCache.has(url)) { const t = texCache.get(url); if (t.image) cb(t); else t.__cbs.push(cb); return; }
    const t = loader.load(url, () => { t.__cbs.forEach(f => f(t)); t.__cbs = []; });
    t.__cbs = [cb]; t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    texCache.set(url, t);
  }
  function build() {
    nodes.forEach(n => { scene.remove(n.m); n.r && scene.remove(n.r); n.m.material.dispose(); n.r && n.r.material.dispose(); });
    nodes = items.map((it, i) => {
      const m = new THREE.Mesh(geo, makeMat(false)); m.userData.i = i; scene.add(m);
      const r = new THREE.Mesh(geo, makeMat(true)); r.scale.y = -1; scene.add(r);
      const n = { m, r, loaded: false };
      return n;
    });
    loadAround();
  }
  function loadAround() {
    const c = Math.round(target);
    nodes.forEach((n, i) => {
      if (n.loaded || Math.abs(i - c) > 4) return;
      n.loaded = true;
      tex(items[i].poster, t => { n.m.material.uniforms.uTex.value = t; n.r.material.uniforms.uTex.value = t; n.m.material.uniforms.uLoaded.value = 1; n.r.material.uniforms.uLoaded.value = 1; });
    });
  }

  function size() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const frac = axis === 'x' ? 0.66 : 0.94;
    let dist = (H / frac) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    if (axis === 'y') { const needW = W / 0.96; const dW = needW / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect); dist = Math.max(dist, dW); }
    camera.position.set(0, axis === 'x' ? -0.09 : 0, dist);
    camera.lookAt(0, axis === 'x' ? -0.09 : 0, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size); ro.observe(host);

  function layout(o) {
    const a = Math.abs(o), s = Math.sign(o), a1 = Math.min(a, 1), a2 = Math.max(a - 1, 0);
    if (axis === 'x') {
      return { x: s * W * (a1 * 1.2 + a2 * 0.62), y: 0, z: -a1 * 0.5 - a2 * 0.22, ry: -s * a1 * 0.9, rx: 0, dim: a1 * 0.32 + a2 * 0.16, vis: a < 5.5 };
    }
    return { x: 0, y: -s * H * (a1 * 1.1 + a2 * 0.14), z: -a1 * 0.55 - a2 * 0.2, ry: 0, rx: s * a1 * 0.42, dim: a1 * 0.4 + a2 * 0.2, vis: a < 3.2 };
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    opts.onChange && opts.onChange(i);
    loadAround();
    startVideo(i);
  }
  let vidTimer = 0;
  function startVideo(i) {
    clearTimeout(vidTimer);
    mixT = 0; videoFor = -1;
    nodes.forEach(n => { n.m.material.uniforms.uMix.value = 0; n.r.material.uniforms.uMix.value = 0; });
    video.pause();
    vidTimer = setTimeout(() => {
      if (active !== i || !items[i] || !items[i].video) return;
      video.src = items[i].video; video.poster = items[i].poster;
      const p = video.play(); if (p && p.catch) p.catch(() => {});
      const on = () => { if (active === i) videoFor = i; video.removeEventListener('playing', on); };
      video.addEventListener('playing', on);
    }, 260);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!dragging) {
      const k = 1 - Math.exp(-dt * 8.5);
      const prev = pos; pos += (target - pos) * k; vel = (pos - prev) / Math.max(dt, 1e-3);
      if (Math.abs(target - pos) < 0.0005) pos = target;
    }
    const bend = THREE.MathUtils.clamp(vel * (axis === 'x' ? -0.25 : 0.25), -1, 1);
    const c = Math.round(pos);
    if (c !== active && c >= 0 && c < items.length) setActive(c);
    if (videoFor === active && active >= 0) mixT = Math.min(1, mixT + dt / 0.9);
    const time = (now - t0) / 1000;
    nodes.forEach((n, i) => {
      const L = layout(i - pos);
      n.m.visible = L.vis; n.r.visible = L.vis && axis === 'x';
      if (!L.vis) return;
      n.m.position.set(L.x, L.y, L.z); n.m.rotation.set(L.rx, L.ry, 0);
      n.r.position.set(L.x, L.y - H - 0.012, L.z); n.r.rotation.set(-L.rx, L.ry, 0);
      const u = n.m.material.uniforms, ur = n.r.material.uniforms;
      u.uDim.value = L.dim; ur.uDim.value = L.dim; u.uTime.value = time; ur.uTime.value = time;
      u.uBend.value = bend; ur.uBend.value = bend;
      const mx = i === videoFor ? mixT : 0; u.uMix.value = mx; ur.uMix.value = mx;
      n.m.renderOrder = 100 - Math.round(Math.abs(i - pos) * 10); n.r.renderOrder = n.m.renderOrder - 50;
    });
    renderer.render(scene, camera);
    if (running && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && running && visible) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // ---- input ----
  let dragging = false, sx = 0, sy = 0, spos = 0, moved = 0, lastMv = 0, lastT = 0, mvVel = 0, pid = null;
  const el = renderer.domElement;
  const unit = () => axis === 'x' ? host.clientWidth * 0.32 : host.clientHeight * 0.9;
  el.addEventListener('pointerdown', e => {
    dragging = true; pid = e.pointerId; sx = e.clientX; sy = e.clientY; spos = pos; moved = 0; mvVel = 0; lastT = performance.now(); lastMv = axis === 'x' ? sx : sy;
    try { el.setPointerCapture(pid); } catch (_) {}
    kick();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pid) return;
    const d = axis === 'x' ? e.clientX - sx : e.clientY - sy;
    moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
    const prev = pos;
    pos = THREE.MathUtils.clamp(spos - d / unit(), -0.35, items.length - 0.65);
    const now = performance.now(), cur = axis === 'x' ? e.clientX : e.clientY;
    const v = -(cur - lastMv) / unit() / Math.max((now - lastT) / 1000, 1e-3);
    mvVel = mvVel * 0.6 + v * 0.4; lastMv = cur; lastT = now; vel = (pos - prev) * 60;
  });
  const end = e => {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false;
    if (moved < 7 && e && e.type === 'pointerup') { click(e); return; }
    let t = Math.round(pos + THREE.MathUtils.clamp(mvVel * 0.18, -2, 2));
    if (axis === 'y') t = THREE.MathUtils.clamp(t, Math.round(spos) - 1, Math.round(spos) + 1);
    go(t);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function click(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(nodes.filter(n => n.m.visible).map(n => n.m));
    if (!hits.length) return go(Math.round(pos));
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder);
    const i = hits[0].object.userData.i;
    if (i === active) opts.onOpen && opts.onOpen(i); else go(i);
  }
  el.addEventListener('wheel', e => {
    if (axis !== 'x') return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 8) { e.preventDefault(); wheelAcc += e.deltaX; if (Math.abs(wheelAcc) > 60) { go(Math.round(target) + Math.sign(wheelAcc)); wheelAcc = 0; } }
  }, { passive: false });
  let wheelAcc = 0;

  const io = new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible) { kick(); if (videoFor === active && video.src) video.play().catch(() => {}); } else video.pause();
  }, { threshold: 0.05 });
  io.observe(host);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) kick(); else video.pause(); });

  function go(i) { if (!items.length) return; target = THREE.MathUtils.clamp(i, 0, items.length - 1); loadAround(); kick(); }

  size();
  return {
    setItems(list, start = 0) {
      items = list; pos = target = Math.min(start, Math.max(list.length - 1, 0)); active = -1; videoFor = -1; video.pause(); video.removeAttribute('src');
      build(); kick();
    },
    go, next() { go(Math.round(target) + 1); }, prev() { go(Math.round(target) - 1); },
    setAxis(a) { if (a === axis) return; axis = a; size(); kick(); },
    index: () => active,
    pause() { video.pause(); }, resume() { if (videoFor === active) video.play().catch(() => {}); },
  };
}
