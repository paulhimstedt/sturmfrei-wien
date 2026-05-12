/**
 * disco-ball.js — Three.js mirror disco ball
 *
 * SCROLL ANIMATION:
 *   Hero  (scroll 0–5%):  full-screen ball, z=1 behind text, all effects visible
 *   Transit (5–90%):  ball physically travels a cubic-bezier arc to the CTA button;
 *                     beams+mist fade out; NO clip-path (sections cover via z-index)
 *   Compact (90%+):   80px clip-circle anchored LEFT of "Book Now" button, z=200
 *
 * Key change from previous version:
 *   clip-path is ONLY applied in compact state (centred on ball's CTA position).
 *   During transit the canvas is unclipped; the z-index stack makes ball visible
 *   through transparent section backgrounds without any "spotlight" artefact.
 */
import * as THREE from 'three';

// ─── CONFIG ───────────────────────────────────────────────────────
const TILE_N    = 1400;
const BALL_R    = 1.0;
const TILE_W    = 0.068;
const BALL_SPIN = 0.26;      // rad/s
const COMPACT_R = 14;        // radius of compact ball in px (fits the 28px nav placeholder)
const CAM_Z     = 3.8;       // camera distance

// ─── STATE ────────────────────────────────────────────────────────
let renderer, scene, camera, ballGroup;
let orbLights = [], beamMeshes = [], mistPoints = null;
let rafId = null, lastTime = 0;
let ballRotY = 0;
let scrollSmooth = 0;   // animation progress 0=hero, 1=compact (time-based, not scroll-position)
let scrollPrev = 0;     // previous raw scrollY for velocity
let scrollVelocity = 0; // px/s — drives extra spin
let vpW = 0, vpH = 0;
let ballSX = 0, ballSY = 0; // ball projected centre on screen
let tanHalfH = 0, tanHalfV = 0;  // precomputed for screen↔world
let heroBallX = 0;               // ball world-X in hero position
let heroBallScale = 1.0;         // hero-state scale — shrinks the ball on narrow viewports

// ─── INIT ─────────────────────────────────────────────────────────
function init() {
  const canvas = document.getElementById('disco-canvas');
  if (!canvas) return;

  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.8;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d1306, 0.09);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0.05, CAM_Z);
  camera.lookAt(0, 0, 0);

  buildEnv();
  buildBall();
  buildLights();
  buildBeams();
  buildMist();

  onResize();   // sizes canvas + computes ball offset
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVis);

  // If the page is restored mid-scroll (back/forward nav, hash link), skip
  // the intro animation — start in the compact state immediately.
  scrollSmooth = window.scrollY > 4 ? 1 : 0;

  animate(0);
}

// ─── MATCAP ───────────────────────────────────────────────────────
function makeMatcap() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#080a06';
  ctx.fillRect(0, 0, S, S);

  function spot(fx, fy, r, col, falloff = 0.45) {
    const g = ctx.createRadialGradient(fx*S, fy*S, 0, fx*S, fy*S, r*S);
    g.addColorStop(0,       col);
    g.addColorStop(falloff, col.replace(/[\d.]+\)$/, '0)'));
    g.addColorStop(1,       'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  // Overhead sun — crisp falloff = each tile either lit or dark → sharp flashes
  spot(0.50, 0.06, 0.44, 'rgba(255,255,255,1.0)',  0.32);
  spot(0.50, 0.03, 0.14, 'rgba(255,255,255,1.0)',  0.28);  // tiny hotspot
  // Front fill — camera-facing tiles are bright silver
  spot(0.50, 0.50, 0.42, 'rgba(210,218,208,0.90)', 0.50);
  spot(0.50, 0.50, 0.20, 'rgba(240,245,235,0.80)', 0.42);
  // Rim lights
  spot(0.02, 0.44, 0.28, 'rgba(215,220,210,0.55)', 0.55);
  spot(0.98, 0.44, 0.28, 'rgba(215,220,210,0.50)', 0.55);
  // Purple accents
  spot(0.16, 0.22, 0.24, 'rgba(215,145,255,0.92)', 0.40);
  spot(0.84, 0.22, 0.24, 'rgba(205,138,248,0.88)', 0.40);
  // Green accents
  spot(0.10, 0.50, 0.20, 'rgba(138,215,108,0.85)', 0.40);
  spot(0.90, 0.50, 0.20, 'rgba(130,208,102,0.80)', 0.40);
  // Yellow accents
  spot(0.26, 0.14, 0.17, 'rgba(235,230,65,0.82)',  0.38);
  spot(0.74, 0.14, 0.17, 'rgba(228,222,60,0.82)',  0.38);
  // Extra white glint top-centre
  spot(0.50, 0.10, 0.08, 'rgba(255,255,255,1.0)',  0.22);
  // Floor bounce
  spot(0.50, 0.82, 0.22, 'rgba(100,140,80,0.28)',  0.60);

  // Clip to circle
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(S/2, S/2, S/2, 0, Math.PI*2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── ENV MAP (for core + atmosphere) ─────────────────────────────
function buildEnv() {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f1208';
  ctx.fillRect(0, 0, W, H);
  [
    [0.5,0.05,80,'rgba(255,255,255,0.80)'],
    [0.15,0.3,60,'rgba(180,130,220,0.60)'],
    [0.85,0.3,55,'rgba(180,130,220,0.55)'],
    [0.35,0.45,50,'rgba(120,190,95,0.50)'],
    [0.65,0.45,50,'rgba(120,190,95,0.45)'],
    [0.25,0.18,45,'rgba(220,215,60,0.40)'],
    [0.75,0.18,45,'rgba(220,215,60,0.40)'],
  ].forEach(([fx,fy,rad,col]) => {
    const g = ctx.createRadialGradient(fx*W,fy*H,0,fx*W,fy*H,rad);
    g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.mapping    = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = tex;
}

// ─── FIBONACCI SPHERE ─────────────────────────────────────────────
function fibonacci(n) {
  const pts = [], phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i/(n-1))*2, r = Math.sqrt(Math.max(0,1-y*y));
    pts.push(new THREE.Vector3(r*Math.cos(phi*i), y, r*Math.sin(phi*i)));
  }
  return pts;
}

// ─── BALL ─────────────────────────────────────────────────────────
function buildBall() {
  ballGroup = new THREE.Group();
  scene.add(ballGroup);

  // Silver core — gaps between tiles read as grout, not black holes
  ballGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R * 0.955, 40, 30),
    new THREE.MeshStandardMaterial({ color: 0xa8b0a8, metalness: 0.7, roughness: 0.45 }),
  ));

  // Mirror tiles — MatcapMaterial: instant bright reflections, no lighting needed
  const geo = new THREE.PlaneGeometry(TILE_W, TILE_W);
  const mat = new THREE.MeshMatcapMaterial({ matcap: makeMatcap() });
  const mesh = new THREE.InstancedMesh(geo, mat, TILE_N);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const pts = fibonacci(TILE_N);
  const mx = new THREE.Matrix4();
  const n  = new THREE.Vector3();
  const up = new THREE.Vector3(0,1,0);
  const rt = new THREE.Vector3();
  const au = new THREE.Vector3();
  const col = new THREE.Color();

  pts.forEach((pt, i) => {
    n.copy(pt).normalize();
    rt.crossVectors(up, n); if (rt.lengthSq()<1e-6) rt.set(1,0,0); rt.normalize();
    au.crossVectors(n, rt).normalize();
    mx.makeBasis(rt, au, n);
    mx.setPosition(pt.clone().multiplyScalar(BALL_R));
    mesh.setMatrixAt(i, mx);
    const rnd = Math.random();
    if      (rnd < 0.07) col.setHex(0xddc0f0);
    else if (rnd < 0.13) col.setHex(0xc0e0a0);
    else if (rnd < 0.17) col.setHex(0xe8e680);
    else { const v=0.88+Math.random()*0.12; col.setRGB(v,v,v*0.985); }
    mesh.setColorAt(i, col);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate  = true;
  ballGroup.add(mesh);
}

// ─── LIGHTS ───────────────────────────────────────────────────────
function buildLights() {
  scene.add(new THREE.AmbientLight(0x1a2010, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(0, 3, 3); scene.add(key);
  [
    { color:0xcc88ff, intensity:8,  speed: 0.55, r:2.8, yo: 0.5,  phase:0 },
    { color:0x88dd66, intensity:6,  speed:-0.40, r:2.5, yo:-0.25, phase:Math.PI*0.667 },
    { color:0xdddd40, intensity:5,  speed: 0.68, r:3.0, yo: 0.15, phase:Math.PI*1.333 },
  ].forEach(def => {
    const l = new THREE.PointLight(def.color, def.intensity, 8, 2.0);
    l.userData = def; scene.add(l); orbLights.push(l);
  });
}

// ─── BEAMS ────────────────────────────────────────────────────────
function buildBeams() {
  const geo = new THREE.ConeGeometry(0.035, 7, 4, 1, true);
  geo.translate(0, -3.5, 0);
  [
    [0.78,0.55,0.72],[0.80,0.50,0.68],[0.35,0.60,0.55],[0.33,0.55,0.52],
    [0.13,0.65,0.60],[0.12,0.60,0.58],[0.00,0.00,0.88],[0.00,0.00,0.82],
  ].forEach((hsl,i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(...hsl),
      transparent:true, opacity:0.030, side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending, depthWrite:false,
    });
    const b = new THREE.Mesh(geo, mat);
    b.userData.baseAngle = (i/8)*Math.PI*2;
    b.userData.tilt      = 0.3 + Math.random()*0.5;
    b.userData.baseOpacity = 0.030;
    scene.add(b); beamMeshes.push(b);
  });
}

// ─── MIST ─────────────────────────────────────────────────────────
function buildMist() {
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 10, 8),
    new THREE.MeshBasicMaterial({
      color:0x0a0e07, transparent:true, opacity:0.10,
      side:THREE.BackSide, depthWrite:false,
    }),
  ));
  const sc = document.createElement('canvas');
  sc.width = sc.height = 32;
  const sctx = sc.getContext('2d');
  const g = sctx.createRadialGradient(16,16,0,16,16,16);
  g.addColorStop(0,'rgba(190,210,175,0.9)');
  g.addColorStop(0.6,'rgba(150,175,135,0.15)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  sctx.fillStyle=g; sctx.fillRect(0,0,32,32);
  const COUNT=70, pos=new Float32Array(COUNT*3);
  for (let i=0;i<COUNT;i++){
    const r=1.5+Math.random()*1.8, theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1);
    pos[i*3]=r*Math.sin(phi)*Math.cos(theta); pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta); pos[i*3+2]=r*Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  mistPoints = new THREE.Points(geo, new THREE.PointsMaterial({
    map:new THREE.CanvasTexture(sc), size:0.22, transparent:true, opacity:0.09,
    blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true, alphaTest:0.005,
  }));
  mistPoints.userData.baseOpacity = 0.09;
  scene.add(mistPoints);
}

// ─── RESIZE ───────────────────────────────────────────────────────
function onResize() {
  vpW = window.innerWidth;
  vpH = window.innerHeight;

  // Canvas always covers full viewport
  renderer.setSize(vpW, vpH, false);
  camera.aspect = vpW / vpH;
  camera.updateProjectionMatrix();

  // Set the wrap div to full screen
  const wrap = document.getElementById('disco-wrap');
  if (wrap) {
    wrap.style.left   = '0px';
    wrap.style.top    = '0px';
    wrap.style.width  = vpW + 'px';
    wrap.style.height = vpH + 'px';
  }

  // Ball world-space X offset — less aggressive than before to keep ball in frame
  const aspect     = vpW / vpH;
  const isPortrait = vpW < vpH;

  const xShift = isPortrait
    ? Math.min(aspect * 0.40, 0.38)   // portrait: subtle offset
    : Math.min(aspect * 0.58, 1.05);  // landscape: right-of-center but not cropped

  heroBallX = xShift;
  ballGroup.position.x = xShift;
  ballGroup.position.y = 0;

  // Hero-state scale by viewport width — keeps the ball roughly viewport-proportional
  // so a phone doesn't get a 580px disco ball on a 390px screen. Beams + mist follow
  // the same scale so the whole atmospheric assembly stays proportionate.
  heroBallScale = vpW < 480 ? 0.42 :
                  vpW < 768 ? 0.62 :
                  vpW < 1024 ? 0.82 :
                  1.0;
  ballGroup.scale.setScalar(heroBallScale);
  beamMeshes.forEach(b => b.scale.setScalar(heroBallScale));
  if (mistPoints) mistPoints.scale.setScalar(heroBallScale);

  // Precompute trig for screen↔world conversions (used every frame in animate)
  const vFovRad = 42 * Math.PI / 180;
  tanHalfV = Math.tan(vFovRad / 2);
  tanHalfH = tanHalfV * aspect;

  // Projected screen position of hero ball centre
  const ndcX = xShift / (CAM_Z * tanHalfH);
  ballSX = ((1 + ndcX) / 2) * vpW;
  ballSY = vpH * 0.50;
}

function onVis() {
  if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
  else if (!rafId) { lastTime = 0; animate(0); }
}

// ─── SCREEN ↔ WORLD ──────────────────────────────────────────────
function screenToWorldX(sx) {
  return ((sx / vpW) * 2 - 1) * CAM_Z * tanHalfH;
}
function screenToWorldY(sy) {
  return -(((sy / vpH) * 2 - 1)) * CAM_Z * tanHalfV;
}

// ─── EASING ───────────────────────────────────────────────────────
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Gentle overshoot for the landing "settle" — c1=1.2 is softer than the default 1.70158
function easeOutBack(t) {
  const c1 = 1.2, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Cubic bezier for a single coordinate (4 control points)
function bez3(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

// ─── ANIMATE ──────────────────────────────────────────────────────
function animate(time) {
  rafId = requestAnimationFrame(animate);
  const dt = lastTime===0 ? 0.016 : Math.min((time-lastTime)/1000, 0.05);
  lastTime = time;

  // ── Read scroll every frame — works on mobile where scroll events are unreliable
  const rawScroll = window.scrollY;

  // ── Scroll velocity (px/s) — drives extra spin
  const rawVelocity = dt > 0 ? (rawScroll - scrollPrev) / dt : 0;
  scrollPrev = rawScroll;
  // Smooth the velocity so spin doesn't stutter
  scrollVelocity += (rawVelocity - scrollVelocity) * Math.min(1, dt * 8);

  // ── Time-based animation: binary target (0=hero, 1=compact) driven by whether
  //    the user has scrolled past a small threshold. Forward and reverse have
  //    different durations — coming back to hero is snappier.
  const SCROLL_THRESHOLD = 4;     // px tolerance near the very top
  const FORWARD_DURATION = 0.9;   // seconds, hero → compact
  const REVERSE_DURATION = 0.4;   // seconds, compact → hero (snappier)

  const targetT = rawScroll > SCROLL_THRESHOLD ? 1 : 0;
  if (targetT > scrollSmooth) {
    scrollSmooth = Math.min(1, scrollSmooth + dt / FORWARD_DURATION);
  } else if (targetT < scrollSmooth) {
    scrollSmooth = Math.max(0, scrollSmooth - dt / REVERSE_DURATION);
  }
  const sp = scrollSmooth;

  // ── Ball spin — base rate + scroll-velocity boost
  const spinRate = BALL_SPIN + Math.abs(scrollVelocity) * 0.0012;
  ballRotY += dt * spinRate;
  ballGroup.rotation.y = ballRotY;

  // ── Orbit lights — orbit around the ball's current world position
  orbLights.forEach(l => {
    const { speed, r, yo, phase } = l.userData;
    const a = ballRotY * speed + phase;
    l.position.set(
      ballGroup.position.x + Math.cos(a) * r,
      yo,
      Math.sin(a) * r
    );
  });

  // ── Beams — follow ball position so they appear rooted to the ball
  beamMeshes.forEach(b => {
    const a = b.userData.baseAngle + ballRotY * 0.16;
    const t = b.userData.tilt;
    b.position.copy(ballGroup.position);
    b.rotation.set(t*Math.cos(a*1.4), a, t*Math.sin(a*1.3));
  });

  // ── Mist — follow ball position
  if (mistPoints) mistPoints.position.copy(ballGroup.position);

  const wrap = document.getElementById('disco-wrap');
  if (!wrap) { renderer.render(scene, camera); return; }

  // Reset any leftover state from the previous fade-out implementation
  wrap.style.opacity      = '1';
  wrap.style.pointerEvents = 'none';

  // ─────────────────────────────────────────────────────────────────
  // SCROLL BEHAVIOR: ball travels from the hero position UP into the
  // nav bar, where it parks next to the DE/EN language toggle.
  //
  // HERO  (sp 0–HERO_END):    full-size ball, full atmospherics
  // TRANSIT (HERO_END→TRANSIT_END): bezier arc up to nav anchor, beams fade
  // COMPACT (>= TRANSIT_END): ball locked next to .nav-ball-space via clip
  // ─────────────────────────────────────────────────────────────────
  // sp is already 0..1 deterministic — no dead bands needed. Tiny epsilons just
  // handle the exact-equals-0 / exact-equals-1 boundary cleanly.
  const HERO_END    = 0.001;
  const TRANSIT_END = 0.999;

  // Anchor ball to the .nav-ball-space placeholder inside the nav-right group.
  // Nav is position:fixed so this stays correct regardless of scroll.
  const ballSpace = document.querySelector('.nav-ball-space');
  const spaceRect = ballSpace ? ballSpace.getBoundingClientRect() : null;
  const compCX = (spaceRect && spaceRect.width > 0)
    ? spaceRect.left + spaceRect.width / 2     // centre of placeholder
    : vpW - 140;                                // fallback: right edge area
  const compCY = (spaceRect && spaceRect.height > 0)
    ? spaceRect.top + spaceRect.height / 2     // centre of placeholder
    : 32;                                       // fallback: top of viewport

  // Scale so the rendered ball matches COMPACT_R px in the compact state.
  const pxPerWorld = (vpH / 2) / (CAM_Z * tanHalfV);
  const compScale  = (COMPACT_R * 0.82) / (BALL_R * pxPerWorld);

  // ── Cubic-bezier control points for the upward arc ───────────────
  //    Start: hero ball (right-of-centre, vertical middle)
  //    End:   nav-ball-space (right side, near top)
  //    The arc should rise smoothly — slight bulge to the right so the ball
  //    doesn't ghost through hero text on the left.
  const cp1X = ballSX + vpW * 0.06;                       // small right drift early
  const cp1Y = ballSY - vpH * 0.18;                       // lift upward
  const cp2X = compCX + (ballSX - compCX) * 0.25;         // approach from slightly left of target
  const cp2Y = compCY + vpH * 0.15;                       // arrive from just below

  let zIndex;

  if (sp <= HERO_END) {
    // ── HERO: full scene visible, no clip-path
    ballGroup.position.x = heroBallX;
    ballGroup.position.y = 0;
    ballGroup.scale.setScalar(heroBallScale);

    beamMeshes.forEach(b => {
      b.material.opacity = b.userData.baseOpacity;
      b.scale.setScalar(heroBallScale);
    });
    if (mistPoints) {
      mistPoints.material.opacity = mistPoints.userData.baseOpacity;
      mistPoints.scale.setScalar(heroBallScale);
    }

    wrap.style.clipPath = 'none';
    zIndex = '1';

  } else if (sp >= TRANSIT_END) {
    // ── COMPACT: ball locked to nav anchor, circular clip
    ballGroup.position.x = screenToWorldX(compCX);
    ballGroup.position.y = screenToWorldY(compCY);
    ballGroup.scale.setScalar(compScale);

    beamMeshes.forEach(b => { b.material.opacity = 0; });
    if (mistPoints) mistPoints.material.opacity = 0;

    wrap.style.clipPath = `circle(${COMPACT_R.toFixed(1)}px at ${compCX.toFixed(1)}px ${compCY.toFixed(1)}px)`;
    zIndex = '200';   // above .nav (z-index 100)

  } else {
    // ── TRANSIT: ball physically travels along the cubic arc upward ──
    const t = sp;   // sp already spans 0..1 over the full animation window

    const te = t < 0.75
      ? easeInOutSine(t / 0.75) * 0.85
      : 0.85 + easeOutBack((t - 0.75) / 0.25) * 0.15;

    const sx = bez3(ballSX, cp1X, cp2X, compCX, te);
    const sy = bez3(ballSY, cp1Y, cp2Y, compCY, te);

    ballGroup.position.x = screenToWorldX(sx);
    ballGroup.position.y = screenToWorldY(sy);

    ballGroup.scale.setScalar(heroBallScale + (compScale - heroBallScale) * te);

    const fadeOut = easeInOutSine(t);
    beamMeshes.forEach(b => {
      b.material.opacity = b.userData.baseOpacity * (1 - fadeOut);
      b.scale.setScalar(heroBallScale);
    });
    if (mistPoints) {
      mistPoints.material.opacity = mistPoints.userData.baseOpacity * (1 - fadeOut);
      mistPoints.scale.setScalar(heroBallScale);
    }

    // NO clip-path during transit — the wrap's z-index lets the ball pass
    // through transparent section backgrounds without a spotlight artefact.
    wrap.style.clipPath = 'none';
    zIndex = '2';
  }

  wrap.style.zIndex = zIndex;
  document.body.classList.toggle('ball-compact', sp >= TRANSIT_END);

  renderer.render(scene, camera);
}

// ─── BOOT ─────────────────────────────────────────────────────────
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.addEventListener('DOMContentLoaded', () => {
    init();
    if (renderer) { renderer.render(scene, camera); cancelAnimationFrame(rafId); }
  });
} else {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
