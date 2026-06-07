import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/* ============================================================
   RENDERER / SCENE / CAMERA
   ============================================================ */
const canvas = document.getElementById('hero-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas, alpha: true, antialias: true, powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.64;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 5.5);

/* ---------- Environment reflections ---------- */
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

/* ---------- Lighting ---------- */
scene.add(new THREE.AmbientLight(0xfff0dd, 0.55));

const key = new THREE.DirectionalLight(0xffeedd, 1.6);
key.position.set(-2, 4, 5);
scene.add(key);

const fill = new THREE.DirectionalLight(0xf5e8d0, 0.35);
fill.position.set(4, 1, -2);
scene.add(fill);

scene.add(new THREE.HemisphereLight(0xfff0dd, 0xcfc0ae, 0.4));

/* ============================================================
   SECTION WAYPOINTS
   ============================================================ */
const BALL_SCALE = 0.97;
const FOOTER_SCALE = 0.5;

// Per-viewport waypoints. On phones the model is centred and dropped lower so
// it floats cleanly under the headline (never behind it), and flies fully off
// to the side during the content sections.
const WAYPOINTS = {
  desktop: {
    hero:   { x:  0.5, y: -0.45, z:  0,    scale: BALL_SCALE },
    stats:  { x:  2.2, y:  0.0,  z:  0,    scale: BALL_SCALE },
    how:    { x: -2.2, y:  0.0,  z:  0,    scale: BALL_SCALE },
    footer: { x:  2.5, y: -1.3,  z: -2.0,  scale: FOOTER_SCALE },
  },
  mobile: {
    hero:   { x:  0.0, y: -0.95, z:  0,    scale: 0.55 },
    stats:  { x:  2.8, y: -0.5,  z:  0,    scale: 0.55 },
    how:    { x: -2.8, y: -0.5,  z:  0,    scale: 0.55 },
    footer: { x:  3.0, y: -1.3,  z: -2.0,  scale: 0.42 },
  },
};

const MOBILE_BP = 600;
const isMobile = () => window.innerWidth <= MOBILE_BP;
const SECTIONS = () => (isMobile() ? WAYPOINTS.mobile : WAYPOINTS.desktop);
let lastWaypoint = null;

let ball = null;
let baseScale = 1;
let ballLoaded = false;
let currentSection = 'hero';

/* ============================================================
   LOAD GLB
   ============================================================ */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('/models/basketball.glb', (gltf) => {
  ball = gltf.scene;

  // Center the model
  const box = new THREE.Box3().setFromObject(ball);
  ball.position.sub(box.getCenter(new THREE.Vector3()));

  // Normalize scale so longest axis = 2.4 units
  const size = box.getSize(new THREE.Vector3());
  baseScale = 2.4 / Math.max(size.x, size.y, size.z);
  const hero = SECTIONS().hero;
  ball.scale.setScalar(baseScale * hero.scale);
  ball.position.set(hero.x, hero.y, hero.z);

  // Material overrides — gritty street look
  ball.traverse((child) => {
    if (child.isMesh && child.material) {
      const m = child.material;
      m.envMapIntensity = 0.15;
      if (m.roughness !== undefined) {
        m.roughness = Math.min(1.0, Math.max(0.82, (m.roughness ?? 0.5) * 1.55));
      }
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.color) m.color.multiplyScalar(0.68);
      m.needsUpdate = true;
    }
  });

  scene.add(ball);
  ballLoaded = true;
  ballEntrance();
}, undefined, (err) => {
  console.error('Failed to load GLB model:', err);
});

/* ============================================================
   ENTRANCE ANIMATION (one-time)
   ============================================================ */
function ballEntrance() {
  const finalScale = baseScale * SECTIONS().hero.scale;
  const finalY = SECTIONS().hero.y;

  ball.scale.setScalar(finalScale * 0.25);
  ball.position.y = finalY - 0.8;

  gsap.to(ball.scale, {
    x: finalScale, y: finalScale, z: finalScale,
    duration: 1.3, ease: 'expo.out', delay: 0.5,
  });
  gsap.to(ball.position, {
    y: finalY,
    duration: 1.3, ease: 'expo.out', delay: 0.5,
    onComplete: enableDrag,
  });
}

/* ============================================================
   AUTO-ROTATION
   ============================================================ */
const BASE_SPEED = 0.003;
let autoVel = {
  x: (Math.random() - 0.5) * 0.003,
  y: BASE_SPEED + Math.random() * 0.002,
};

/* ============================================================
   DRAG PHYSICS
   ============================================================ */
const DAMPING = 0.94;
let isDragging = false;
let dragActive = false;
const prevMouse = { x: 0, y: 0 };
const velocity = { x: 0, y: 0 };
let momentumRAF = null;

function enableDrag() {
  dragActive = true;
  if (currentSection === 'hero') canvas.classList.add('drag-enabled');
}

function getPos(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function onDown(e) {
  if (!dragActive || currentSection !== 'hero' || !ball) return;
  isDragging = true;
  canvas.classList.add('grabbing');
  const p = getPos(e);
  prevMouse.x = p.x;
  prevMouse.y = p.y;
  if (momentumRAF) cancelAnimationFrame(momentumRAF);
}

function onMove(e) {
  if (!isDragging || !ball) return;
  // While actively spinning the ball, stop the page from scrolling under the touch
  if (e.cancelable) e.preventDefault();
  const p = getPos(e);
  velocity.x = (p.y - prevMouse.y) * 0.006;
  velocity.y = (p.x - prevMouse.x) * 0.006;
  ball.rotation.x += velocity.x;
  ball.rotation.y += velocity.y;
  prevMouse.x = p.x;
  prevMouse.y = p.y;
}

function onUp() {
  if (!isDragging) return;
  isDragging = false;
  canvas.classList.remove('grabbing');
  coast();
}

function coast() {
  velocity.x *= DAMPING;
  velocity.y *= DAMPING;
  if (ball) {
    ball.rotation.x += velocity.x;
    ball.rotation.y += velocity.y;
  }
  if (Math.abs(velocity.x) > 0.0008 || Math.abs(velocity.y) > 0.0008) {
    momentumRAF = requestAnimationFrame(coast);
  } else {
    // keep spinning in the thrown direction
    const mag = Math.hypot(velocity.x, velocity.y) || 1;
    autoVel.x = (velocity.x / mag) * BASE_SPEED * 0.6;
    autoVel.y = (velocity.y / mag) * (BASE_SPEED + Math.random() * 0.001) || BASE_SPEED;
    if (Math.abs(autoVel.y) < 0.0015) autoVel.y = BASE_SPEED;
  }
}

canvas.addEventListener('mousedown', onDown);
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
canvas.addEventListener('touchstart', onDown, { passive: true });
window.addEventListener('touchmove', onMove, { passive: false });
window.addEventListener('touchend', onUp);

/* ============================================================
   SCROLL-DRIVEN BALL POSITIONING
   ============================================================ */
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function depthOffset(y) { return y < 0 ? y * 0.4 : 0; }

function applyWaypoint(fromKey, toKey, p) {
  if (!ball) return;
  lastWaypoint = { fromKey, toKey, p };
  const set = SECTIONS();
  const from = set[fromKey];
  const to = set[toKey];
  const ey = easeInOut(p);
  const x = lerp(from.x, to.x, p);
  const y = lerp(from.y, to.y, ey);
  const z = lerp(from.z, to.z, p) + depthOffset(y);
  const s = lerp(from.scale, to.scale, p);
  ball.position.set(x, y, z);
  ball.scale.setScalar(baseScale * s);
}

function setSection(name) {
  currentSection = name;
  if (name === 'hero' && dragActive) canvas.classList.add('drag-enabled');
  else canvas.classList.remove('drag-enabled');
}

function setupScrollBall() {
  // Hero -> Stats
  ScrollTrigger.create({
    trigger: '#stats-section', start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => applyWaypoint('hero', 'stats', self.progress),
    onEnter: () => setSection('stats'),
    onLeaveBack: () => setSection('hero'),
  });
  // Stats -> How
  ScrollTrigger.create({
    trigger: '#how-section', start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => applyWaypoint('stats', 'how', self.progress),
    onEnter: () => setSection('how'),
    onLeaveBack: () => setSection('stats'),
  });
  // How -> Footer
  ScrollTrigger.create({
    trigger: '#site-footer', start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => applyWaypoint('how', 'footer', self.progress),
    onEnter: () => setSection('footer'),
    onLeaveBack: () => setSection('how'),
  });
}

/* ============================================================
   SCROLL-TRIGGERED SECTION CONTENT
   ============================================================ */
ScrollTrigger.create({
  trigger: '#stats-section', start: 'top 75%',
  onEnter: () => gsap.to('.stat-card', {
    opacity: 1, y: 0, stagger: 0.1, duration: 0.8, ease: 'expo.out', delay: 0.1,
  }),
});
ScrollTrigger.create({
  trigger: '#how-section', start: 'top 70%',
  onEnter: () => gsap.to('.step-item', {
    opacity: 1, x: 0, stagger: 0.15, duration: 0.9, ease: 'expo.out', delay: 0.1,
  }),
});

/* ============================================================
   NAVBAR SCROLL STATE
   ============================================================ */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 80) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
});

/* ============================================================
   UI ENTRANCE SEQUENCE
   ============================================================ */
const introTl = gsap.timeline({ delay: 0.15 });
introTl
  .to('.nav-logo',    { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.1)
  .to('.nav-links',   { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.15)
  .to('.profile-btn', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2)
  .to('#ph-badge',    { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' }, 0.4)
  .to('#event-card',  { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out' }, 0.55)
  .to('#hero-text',   { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out' }, 0.65)
  .to('#nav-arrow',   { opacity: 1, duration: 0.5, ease: 'power2.out' }, 1.1)
  .to('#sig-wrap',    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.2)
  .to('.sp1', { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut' }, 1.2)
  .to('.sp2', { strokeDashoffset: 0, duration: 1.0, ease: 'power2.inOut' }, 1.8)
  .to('.sp3', { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, 2.0);

// Set initial transform state the timeline animates from
gsap.set('#hero-text', { x: 40 });

/* ============================================================
   EVENT CARD HOVER (GSAP)
   ============================================================ */
const eventCardEl = document.getElementById('event-card');
if (eventCardEl) {
  eventCardEl.addEventListener('mouseenter', () =>
    gsap.to(eventCardEl, { scale: 1.035, y: -6, duration: 0.55, ease: 'power3.out', overwrite: 'auto' }));
  eventCardEl.addEventListener('mouseleave', () =>
    gsap.to(eventCardEl, { scale: 1.0, y: 0, duration: 0.55, ease: 'power3.out', overwrite: 'auto' }));
}

/* ============================================================
   NAV ARROW -> scroll to stats
   ============================================================ */
document.getElementById('nav-arrow')?.addEventListener('click', () => {
  document.getElementById('stats-section')?.scrollIntoView({ behavior: 'smooth' });
});

/* ============================================================
   RENDER LOOP
   ============================================================ */
function animate() {
  requestAnimationFrame(animate);
  if (ball && !isDragging) {
    ball.rotation.x += autoVel.x;
    ball.rotation.y += autoVel.y;
  }
  renderer.render(scene, camera);
}
animate();

/* ============================================================
   RESIZE
   ============================================================ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Re-place the ball for the current breakpoint so it never drifts off
  if (ball) {
    if (lastWaypoint) {
      applyWaypoint(lastWaypoint.fromKey, lastWaypoint.toKey, lastWaypoint.p);
    } else {
      const hero = SECTIONS().hero;
      ball.position.set(hero.x, hero.y, hero.z);
      ball.scale.setScalar(baseScale * hero.scale);
    }
  }
  ScrollTrigger.refresh();
});

/* ============================================================
   ON LOAD
   ============================================================ */
window.addEventListener('load', () => {
  setupScrollBall();
  ScrollTrigger.refresh();
});
