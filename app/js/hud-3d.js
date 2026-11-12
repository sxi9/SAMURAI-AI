/* SAMURAI HUD v3 — 3D core (ES module). A WebGL layer behind the widgets: a nebula shader background, a particle field of
   up to 24,000 points that morphs through the same shapes as the 2D core, a volumetric glass orb that follows the avatar and
   lip-syncs to the voice, an optional VRM avatar (three-vrm) in the same scene, bloom, and a holographic globe for the
   position widget. Falls back to the 2D canvas when WebGL is slow or missing. Exposes window.SAM.gl. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SAM = window.SAM;
const W = 1920, H = 1080, CY = 470;                                   // stage size, core centre y (x = 960)
const QUALITY = { low: { n: 8000, pr: .5, bloom: true }, medium: { n: 12000, pr: .7, bloom: true }, high: { n: 24000, pr: 1, bloom: true } };
const NOISE = `
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453123);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash3(i).x,hash3(i+vec3(1,0,0)).x,f.x),mix(hash3(i+vec3(0,1,0)).x,hash3(i+vec3(1,1,0)).x,f.x),f.y),
            mix(mix(hash3(i+vec3(0,0,1)).x,hash3(i+vec3(1,0,1)).x,f.x),mix(hash3(i+vec3(0,1,1)).x,hash3(i+vec3(1,1,1)).x,f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return v;}`;


/* icon shapes for widget morphs: drawn on a small canvas, then sampled like spelled words */
function drawIcon(x, w, h, name) {
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineWidth = 16; x.lineCap = 'round'; x.lineJoin = 'round'; const cx = w / 2, cy = h / 2;
  if (name === 'cloud') { for (const [dx, dy, r] of [[-60, 10, 34], [-20, -18, 44], [30, -8, 40], [62, 14, 30], [0, 22, 36]]) { x.beginPath(); x.arc(cx + dx, cy + dy, r, 0, 6.283); x.fill(); } }
  else if (name === 'pulse') { x.beginPath(); x.moveTo(cx - 150, cy); x.lineTo(cx - 70, cy); x.lineTo(cx - 50, cy - 40); x.lineTo(cx - 25, cy + 55); x.lineTo(cx, cy - 60); x.lineTo(cx + 20, cy + 20); x.lineTo(cx + 40, cy); x.lineTo(cx + 150, cy); x.stroke(); }
  else if (name === 'house') { x.beginPath(); x.moveTo(cx - 90, cy + 10); x.lineTo(cx, cy - 60); x.lineTo(cx + 90, cy + 10); x.stroke(); x.strokeRect(cx - 65, cy + 5, 130, 60); x.fillRect(cx - 14, cy + 25, 28, 40); }
  else if (name === 'pin') { x.beginPath(); x.arc(cx, cy - 22, 40, Math.PI * .8, Math.PI * 2.2); x.lineTo(cx, cy + 62); x.closePath(); x.fill(); x.fillStyle = '#000'; x.beginPath(); x.arc(cx, cy - 22, 16, 0, 6.283); x.fill(); }
  else if (name === 'clock') { x.beginPath(); x.arc(cx, cy, 62, 0, 6.283); x.stroke(); x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - 40); x.moveTo(cx, cy); x.lineTo(cx + 30, cy + 12); x.stroke(); }
  else if (name === 'envelope') { x.strokeRect(cx - 95, cy - 50, 190, 100); x.beginPath(); x.moveTo(cx - 95, cy - 50); x.lineTo(cx, cy + 10); x.lineTo(cx + 95, cy - 50); x.stroke(); }
  else if (name === 'check') { x.lineWidth = 22; x.beginPath(); x.moveTo(cx - 80, cy); x.lineTo(cx - 20, cy + 50); x.lineTo(cx + 90, cy - 50); x.stroke(); }
  else if (name === 'note') { x.font = 'bold 150px "DejaVu Sans", "Segoe UI Symbol", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♪', cx, cy + 10); }
  else if (name === 'eye') { x.beginPath(); x.ellipse(cx, cy, 100, 48, 0, 0, 6.283); x.stroke(); x.beginPath(); x.arc(cx, cy, 26, 0, 6.283); x.fill(); }
  else if (name === 'screen') { x.strokeRect(cx - 100, cy - 60, 200, 120); x.fillRect(cx - 40, cy + 62, 80, 12); }
  else if (name === 'globe') { x.beginPath(); x.arc(cx, cy, 64, 0, 6.283); x.stroke(); x.beginPath(); x.ellipse(cx, cy, 28, 64, 0, 0, 6.283); x.stroke(); x.beginPath(); x.moveTo(cx - 64, cy); x.lineTo(cx + 64, cy); x.stroke(); }
  else { x.font = 'bold 120px Michroma, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name.slice(0, 3).toUpperCase(), cx, cy); }
}

/* the same shape generators as the 2D core, for any particle count */
function shapeOf(name, N) {
  const a = new Float32Array(N * 3), R = Math.random, set = (i, x, y, z) => { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; };
  if (name === 'heart') for (let i = 0; i < N; i++) { const t = R() * 6.283, r = Math.sqrt(R()); const hx = 16 * Math.pow(Math.sin(t), 3), hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); set(i, r * hx / 17, r * hy / 17 + .05, (R() - .5) * .25 * (1 - r)); }
  else if (name === 'cube') for (let i = 0; i < N; i++) { const f = (R() * 6) | 0, s = .75, u = (R() - .5) * 2 * s, v = (R() - .5) * 2 * s; set(i, f === 0 ? s : f === 1 ? -s : u, f === 2 ? s : f === 3 ? -s : (f < 2 ? u : v), f === 4 ? s : f === 5 ? -s : v); }
  else if (name === 'galaxy') for (let i = 0; i < N; i++) { const arm = i % 3, k = Math.pow(R(), .6), r = .12 + k * .95, t = k * 4.5 + arm / 3 * 6.283 + (R() - .5) * .35; set(i, Math.cos(t) * r, Math.sin(t) * r, (R() - .5) * .12 * (1 - k)); }
  else if (name === 'helix') for (let i = 0; i < N; i++) { const strand = i % 2, k = Math.floor(i / 2) / (N / 2), t = k * Math.PI * 6 + strand * Math.PI, r = (i % 24 === 0) ? .45 * R() : .45; set(i, Math.cos(t) * r, (k - .5) * 2, Math.sin(t) * r); }
  else if (name === 'knot') for (let i = 0; i < N; i++) { const t = (i / N) * 6.283 * 2, r = .62 + .22 * Math.cos(1.5 * t), j = () => (R() - .5) * .05; set(i, r * Math.cos(t) + j(), .24 * Math.sin(1.5 * t) + j(), r * Math.sin(t) + j()); }
  else if (name === 'ring') for (let i = 0; i < N; i++) { const t = (i / N) * 6.283, tube = R() * 6.283, Rr = .85, T = .07 + R() * .05; set(i, (Rr + T * Math.cos(tube)) * Math.cos(t), T * Math.sin(tube), (Rr + T * Math.cos(tube)) * Math.sin(t)); }
  else if (name === 'wave') { const side = Math.sqrt(N) | 0; for (let i = 0; i < N; i++) { const gx = (i % side) / side - .5, gz = Math.floor(i / side) / side - .5, d = Math.hypot(gx, gz); set(i, gx * 2.2, Math.sin(d * 18) * .22 * (1 - d), gz * 2.2); } }
  else if (name.startsWith('text:') || name.startsWith('icon:')) {
    const word = name.slice(5), c = document.createElement('canvas'), w = 360, h = 160; c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (name.startsWith('icon:')) drawIcon(x, w, h, word);
    else { let size = 110; do { x.font = `bold ${size}px Michroma, Arial Black, sans-serif`; size -= 6; } while (x.measureText(word).width > w - 24 && size > 16); x.fillText(word, w / 2, h / 2); }
    const img = x.getImageData(0, 0, w, h).data, pts = [];
    for (let py = 0; py < h; py += 2) for (let px = 0; px < w; px += 2) if (img[(py * w + px) * 4 + 3] > 110) pts.push(px, py);
    if (!pts.length) return shapeOf('sphere', N);
    for (let i = 0; i < N; i++) { const k = ((R() * pts.length / 2) | 0) * 2; set(i, (pts[k] / w - .5) * 2.3 + (R() - .5) * .02, (.5 - pts[k + 1] / h) * 2.3 * (h / w) + (R() - .5) * .02, (R() - .5) * .12); }
  }
  else { const phi = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = phi * i; set(i, Math.cos(th) * r, y, Math.sin(th) * r); } }
  return a;
}
const rgb = s => new THREE.Color(...s.split(',').map(v => +v / 255));
const SHAPE_TILT = { sphere: .3, heart: 0, text: 0, cube: .35, galaxy: .25, helix: .15, knot: .35, ring: .75, wave: .85 }, FACING = { heart: 1, text: 1, galaxy: 1 };

const gl = {
  QUALITY,
  on: false, quality: 'medium', fps: 0, speechLevel: 0, energy: 0, ready: false, failed: '',
  canvas: null, renderer: null, scene: null, camera: null, composer: null, bloom: null,
  nebula: null, points: null, orb: null, halo: null, N: 0, shapes: {}, ppos: null, pfrom: null, ptarget: null, pdelay: null, morphT: 1, shapeName: 'sphere', spin: 0, tilt: .3, lastTs: 0, raf: 0,
  glitch: 0, vrm: null, vrmLoading: '', vrmFailed: '',
  VRM_SCALE: 640, VRM_Y: 46, VRM_CUT: -214,                                 // bust framing: model units -> px, head bone above the orb centre, where the body fades out (px, group space)

  enable(quality) {
    if (this.on) return true;
    const Q = QUALITY[quality] || QUALITY.medium; this.quality = QUALITY[quality] ? quality : 'medium';
    try {
      if (!this.canvas) { const c = document.createElement('canvas'); c.id = 'gl'; c.className = 'gl'; const bg = document.getElementById('bg'); bg.parentNode.insertBefore(c, bg.nextSibling); this.canvas = c; }
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, powerPreference: 'high-performance', premultipliedAlpha: false });
    } catch (e) { this.failed = 'WebGL unavailable'; return false; }
    const r = this.renderer; r.setPixelRatio(Q.pr); r.setSize(W, H, false); r.setClearColor(0x000000, 0); r.toneMapping = THREE.NoToneMapping;
    this.scene = new THREE.Scene(); r.localClippingEnabled = true;
    const fov = 40, D = (H / 2) / Math.tan(fov / 2 * Math.PI / 180);
    this.camera = new THREE.PerspectiveCamera(fov, W / H, 10, 6000); this.camera.position.set(0, -(540 - CY), D); this.camera.lookAt(0, -(540 - CY), 0); this.D = D;
    this.buildNebula(D); this.buildParticles(Q.n); this.buildOrb();
    if (this.vrm) this.scene.add(this.vrm.group);                                  // an avatar kept across a quality change comes straight back
    if (Q.bloom) {
      this.composer = new EffectComposer(r); this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(W * Q.pr / 2, H * Q.pr / 2), .6, .4, .4); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    } else this.composer = null;
    this.on = true; this.ready = true; document.getElementById('stage').classList.add('gl'); SAM.core.particles = false;
    try { const c = r.getContext(), dbg = c.getExtension('WEBGL_debug_renderer_info'); this.renderer_name = dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (c.getParameter(c.RENDERER) || ''); this.vendor_name = dbg ? c.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : ''; } catch (e) { this.renderer_name = ''; }
    setTimeout(() => this.report(), 7000);
    let skip = false;                                                       // below high quality the GL layer renders every other frame (30 fps): half the GPU cost, no visible loss
    const loop = ts => { if (!this.on) return; skip = !skip && this.quality !== 'high'; if (!skip) this.frame(ts); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop);
    return true;
  },
  disable(keepVrm) {                                                            // keepVrm: a quality change rebuilds the renderer but keeps the parsed 11 MB avatar
    if (!this.on) return; this.on = false; cancelAnimationFrame(this.raf); if (keepVrm && this.vrm) this.scene.remove(this.vrm.group); else this.disposeVrm(); this.vrmLoading = '';
    document.getElementById('stage').classList.remove('gl'); SAM.core.particles = true;
    try { this.renderer.dispose(); this.composer && this.composer.dispose(); } catch (e) { }
    this.renderer = null; this.composer = null; this.scene = null; if (this.canvas) this.canvas.remove(); this.canvas = null;
  },
  setQuality(q) { const was = this.on; if (was) this.disable(true); this.quality = q; if (was) this.enable(q); },

  buildNebula(D) {
    const z = -900, k = (D - z) / D, geo = new THREE.PlaneGeometry(W * k * 1.08, H * k * 1.08);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uA: { value: rgb(SAM.core.THEME.c) }, uB: { value: rgb(SAM.core.THEME.v) }, uRed: { value: 0 }, uEnergy: { value: .5 }, uStir: { value: .15 }, uGlitch: { value: 0 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp float;varying vec2 vUv;uniform float uTime,uRed,uEnergy,uStir,uGlitch;uniform vec3 uA,uB;${NOISE}
        void main(){vec2 p=(vUv-.5)*vec2(1.78,1.);float t=uTime*uStir;
          float n1=fbm(vec3(p*2.2+vec2(t*.3,-t*.17),t*.4));float n2=fbm(vec3(p*4.5-vec2(t*.2,t*.11),3.+t*.3));
          float n=smoothstep(.35,.85,n1*.7+n2*.45);
          vec3 col=mix(uB,uA,smoothstep(.3,.9,n2))*n;
          col=mix(col,vec3(1.,.24,.43)*n*1.4,uRed);
          float d=length(p);float ring=smoothstep(.0,.55,d);          // keep the centre clear for the core
          float a=n*(.1+.32*uEnergy)*ring*(1.-smoothstep(.75,1.05,d));
          if(uGlitch>0.){float g=step(.985,hash3(vec3(floor(vUv.y*90.),floor(uTime*24.),1.)).x)*uGlitch;col+=vec3(g);a+=g*.35;}
          gl_FragColor=vec4(col,a);}`
    });
    this.nebula = new THREE.Mesh(geo, mat); this.nebula.position.set(0, -(540 - CY), z); this.nebula.renderOrder = -2; this.scene.add(this.nebula);
  },
  buildParticles(N) {
    this.N = N; this.shapes = {}; this.ppos = shapeOf('sphere', N); this.pfrom = this.ppos.slice(); this.ptarget = this.getShape(SAM.core.shapeName || 'sphere'); this.shapeName = SAM.core.shapeName || 'sphere';
    if (this.shapeName !== 'sphere') { this.pfrom = this.ppos.slice(); this.morphT = 0; }
    this.pdelay = new Float32Array(N); const seed = new Float32Array(N); for (let i = 0; i < N; i++) { this.pdelay[i] = Math.random(); seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.ppos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSpin: { value: 0 }, uTilt: { value: .3 }, uRadius: { value: 380 }, uCenter: { value: new THREE.Vector3(0, 0, 0) }, uA: { value: rgb(SAM.core.THEME.c) }, uB: { value: rgb(SAM.core.THEME.v) }, uMode: { value: 0 }, uShow: { value: 0 }, uPR: { value: 1 }, uMusic: { value: 0 }, uDim: { value: 1 } },
      vertexShader: `attribute float seed;uniform float uTime,uSpin,uTilt,uRadius,uShow,uPR,uMusic;uniform vec3 uCenter;varying float vD;varying float vS;
        void main(){vec3 p=position;p+=.012*vec3(sin(uTime*1.3+seed*40.),cos(uTime*1.1+seed*31.),sin(uTime*.9+seed*17.));
          p*=1.+uMusic*.08*sin(uTime*20.+seed*6.28);
          float cs=cos(uSpin),sn=sin(uSpin);vec3 p1=vec3(p.x*cs-p.z*sn,p.y,p.x*sn+p.z*cs);
          float ct=cos(uTilt),st=sin(uTilt);vec3 p2=vec3(p1.x,p1.y*ct-p1.z*st,p1.y*st+p1.z*ct);
          vec4 mv=modelViewMatrix*vec4(p2*uRadius+uCenter,1.);vD=(p2.z+1.)*.5;vS=seed;
          gl_PointSize=(1.5+vD*2.3+uShow*2.4)*uPR*(1500./-mv.z);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `precision highp float;uniform vec3 uA,uB;uniform float uMode,uShow,uDim;varying float vD;varying float vS;
        void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.08,d);
          vec3 c=mix(uB,uA,smoothstep(.35,.75,vD));if(uMode==1.)c=uB;if(uMode==2.)c=vec3(1.,.24,.43);
          float br=(.18+vD*.5+uShow*.3+step(.985,vS)*.7)*uDim;gl_FragColor=vec4(c*br,a*(.35+.45*vD+uShow*.3)*uDim);}`
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = -1; this.scene.add(this.points);
  },
  buildOrb() {
    const geo = new THREE.SphereGeometry(96, 48, 32);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: { uTime: { value: 0 }, uA: { value: rgb(SAM.core.THEME.c) }, uB: { value: rgb(SAM.core.THEME.v) }, uRed: { value: 0 }, uTalk: { value: 0 }, uEnergy: { value: .5 } },
      vertexShader: `varying vec3 vN;varying vec3 vP;varying vec3 vV;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);vP=position;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `precision highp float;varying vec3 vN,vP,vV;uniform float uTime,uRed,uTalk,uEnergy;uniform vec3 uA,uB;${NOISE}
        void main(){float fr=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.2);
          float n=fbm(vP*.018+vec3(uTime*.25,uTime*.17,-uTime*.21));float n2=fbm(vP*.04-vec3(0.,uTime*.5,0.));
          float plasma=smoothstep(.38,.8,n)*(.5+.5*n2);
          vec3 col=mix(uB,uA,plasma)*(.35+.9*plasma)*(.6+.8*uEnergy);
          col+=uA*fr*1.3;col=mix(col,vec3(1.,.24,.43)*(fr*1.4+plasma),uRed);
          col+=vec3(1.)*uTalk*plasma*.6;
          float a=clamp(fr*.9+plasma*.55+uTalk*.15,0.,1.);gl_FragColor=vec4(col,a);}`
    });
    this.orb = new THREE.Mesh(geo, mat); this.scene.add(this.orb);
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.3, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: rgb(SAM.core.THEME.c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .55 }));
    this.halo.scale.set(330, 330, 1); this.halo.renderOrder = -1; this.scene.add(this.halo);
  },
  getShape(name) { if (!this.shapes[name]) this.shapes[name] = shapeOf(name, this.N); return this.shapes[name]; },

  /* ---- VRM avatar (three-vrm): loaded lazily when the avatar is set to 'vrm', framed head-and-shoulders where the orb is,
     lit with a soft warm key and a cyan parametric rim, driven by SAM.face (expressions, visemes, blink, gaze) ---- */
  async loadVrm() {
    if (this.vrm || this.vrmLoading) return; const url = SAM.face.vrmUrl(); this.vrmLoading = url;
    const hud = SAM.hud; hud.log('info', 'avatar · loading ' + decodeURIComponent(url.split('/').pop()) + ' …');
    try {
      const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm')]);
      const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url); const vrm = gltf.userData.vrm;
      if (!this.on || this.vrmLoading !== url) { VRMUtils.deepDispose(gltf.scene); this.vrmLoading = ''; return; }
      VRMUtils.removeUnnecessaryVertices(gltf.scene); VRMUtils.combineSkeletons(gltf.scene); VRMUtils.rotateVRM0(vrm);
      const hum = vrm.humanoid, bone = n => hum && hum.getNormalizedBoneNode(n);
      const lUA = bone('leftUpperArm'), rUA = bone('rightUpperArm'); if (lUA) lUA.rotation.z = -1.2; if (rUA) rUA.rotation.z = 1.2;   // arms down from the T-pose
      const clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.VRM_CUT), mats = [], rims = [];
      vrm.scene.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) if (m) { m.clippingPlanes = [clip]; m.clipping = true; mats.push(m); if (m.isMToonMaterial) { rims.push(m); m.parametricRimFresnelPowerFactor = 5; m.parametricRimLiftFactor = 0; } m.needsUpdate = true; } });
      vrm.scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.renderOrder = 1; });                                // after the particle field, the halo and the nebula (blend materials write no depth)
      const g = new THREE.Group(); const SC = this.VRM_SCALE; vrm.scene.scale.setScalar(SC); g.add(vrm.scene);
      vrm.scene.updateMatrixWorld(true); const head = bone('head'), hp = new THREE.Vector3(); if (head) head.getWorldPosition(hp); else hp.set(0, 1.4 * SC, 0);
      vrm.scene.position.set(-hp.x, -hp.y, -hp.z);                                                            // the head sits on the group's origin
      const key = new THREE.DirectionalLight(0xfff6ee, 1.1); key.position.set(300, 700, 1100); g.add(key); g.add(new THREE.HemisphereLight(0x8a94a8, 0x0a0e14, .12));
      const target = new THREE.Object3D(); g.add(target); if (vrm.lookAt) vrm.lookAt.target = target;
      g.add(this.fadePlane()); g.position.y = this.VRM_Y;
      this.scene.add(g); g.updateMatrixWorld(true);
      /* spring bones (hair, ribbons) are tuned for metres; the scene works in pixels, so scale their settings and take the rest pose from the final placement, or the hair flies outward */
      const sb = vrm.springBoneManager; if (sb) { try { for (const j of sb.joints) { j.settings.stiffness *= SC; j.settings.gravityPower *= SC; j.settings.hitRadius *= SC; } for (const c of sb.colliders || []) { const sh = c.shape; if (sh) { if (sh.radius != null) sh.radius *= SC; sh.offset && sh.offset.multiplyScalar(SC); sh.tail && sh.tail.multiplyScalar(SC); } } sb.setInitState(); sb.reset(); } catch (e) { vrm.springBoneManager = null; } }
      this.vrm = { vrm, group: g, target, head, neck: bone('neck'), em: vrm.expressionManager, cur: {}, url, clip, mats, rims, rimKey: '' }; this.vrmLoading = '';
      hud.log('ok', `avatar · ${(vrm.meta && (vrm.meta.name || vrm.meta.title)) || 'VRM'} ready`);
    } catch (e) { this.vrmLoading = ''; this.vrmFailed = url; hud.log('warn', 'avatar · could not load the VRM · ' + String(e.message || e).slice(0, 70)); }
  },
  /* the bust fades out below the shoulders instead of ending in a hard cut: a plane in front of the body that erases what is
     behind it (colour and alpha, dst *= 1 - a) so the page shows through, strongest at the cut, gone sideways and upwards */
  fadePlane() {
    const h = 120, geo = new THREE.PlaneGeometry(1000, h), mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp float;varying vec2 vUv;void main(){float a=smoothstep(.0,.9,1.-vUv.y)*(1.-smoothstep(.26,.5,abs(vUv.x-.5)));gl_FragColor=vec4(0.,0.,0.,a);}`
    });
    const m = new THREE.Mesh(geo, mat); m.position.set(0, this.VRM_CUT + h / 2 - 4, 300); m.renderOrder = 50; return m;
  },
  disposeVrm() {
    const V = this.vrm; if (!V) return; this.vrm = null; this.scene && this.scene.remove(V.group);
    import('@pixiv/three-vrm').then(({ VRMUtils }) => VRMUtils.deepDispose(V.vrm.scene)).catch(() => { });
  },
  updateVrm(dt, t) {
    const V = this.vrm, F = SAM.face, wd = SAM.hud.WD || {}, em = V.em; if (!em) return;
    const want = Object.assign({}, F.VRM_EXPR ? F.VRM_EXPR[F.shown] : {}), k = Math.min(1, dt * 8), rimKey = SAM.core.THEME.c;
    if (rimKey !== V.rimKey) { V.rimKey = rimKey; const c = rgb(rimKey).multiplyScalar(.7); for (const m of V.rims) m.parametricRimColorFactor = c; }   // the rim follows the theme
    for (const name of ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'lookUp', 'lookLeft']) { const tv = (want[name] || 0) * F.shownIntensity; V.cur[name] = (V.cur[name] || 0) + (tv - (V.cur[name] || 0)) * k; em.setValue(name, V.cur[name]); }
    for (const v in F.vis) em.setValue(v, F.vis[v]);
    em.setValue('blink', F.blinkV);
    /* gaze and a little head life: the look-at target floats in front of the camera, the head turns part of the way */
    V.target.position.set(F.lookX * 900, -F.lookY * 600, 1400);
    const idle = SAM.core.mode === 'idle', hx = F.lookX * .22 + (idle ? Math.sin(t * .37) * .05 : 0), hy = -F.lookY * .18 + (idle ? Math.sin(t * .29 + 1) * .03 : 0);
    if (V.head) { V.head.rotation.y += (hx - V.head.rotation.y) * k; V.head.rotation.x += (hy - V.head.rotation.x) * k; V.head.rotation.z += ((idle ? Math.sin(t * .23) * .03 : 0) - V.head.rotation.z) * k; }
    if (V.neck) V.neck.rotation.y += (hx * .4 - V.neck.rotation.y) * k;
    V.group.position.set((wd.ox || 0) * .25, -(wd.oy || 0) * .25 + this.VRM_Y, 0); V.clip.constant = -(this.VRM_CUT + V.group.position.y);   // the cut (world space) moves with the bust
    V.vrm.update(dt);
  },

  /* lip-sync level: the face controller owns the one audio analyser (shared with the robot face) */
  speech() { return SAM.face ? SAM.face.lvl : 0; },

  frame(ts) {
    const core = SAM.core, hud = SAM.hud, t = ts / 1000, dt = Math.min(.05, (ts - (this.lastTs || ts)) / 1000); this.lastTs = ts;
    const m = core.mode, mode = m === 'thinking' ? 1 : m === 'alert' ? 2 : 0, red = m === 'alert' ? 1 : 0;
    this.fps = this.fps * .95 + (dt ? 1 / dt : 60) * .05;
    /* theme colours follow the 2D core */
    const A = rgb(core.THEME.c), B = rgb(core.THEME.v);
    /* shapes: follow whatever the 2D core was told */
    if (core.shapeName !== this.shapeName) { this.pfrom = this.ppos.slice(); this.ptarget = this.getShape(core.shapeName); this.morphT = 0; this.shapeName = core.shapeName; }
    if (this.morphT < 1) {
      this.morphT = Math.min(1, this.morphT + dt / 1.6); const P = this.ppos, F = this.pfrom, T = this.ptarget, D = this.pdelay, N = this.N;
      for (let i = 0; i < N; i++) { let k = (this.morphT - D[i] * .45) / .55; k = k < 0 ? 0 : k > 1 ? 1 : k; k = k * k * (3 - 2 * k); for (let j = 0; j < 3; j++) P[i * 3 + j] = F[i * 3 + j] + (T[i * 3 + j] - F[i * 3 + j]) * k; }
      this.points.geometry.attributes.position.needsUpdate = true;
    }
    const base = this.shapeName.startsWith('text:') || this.shapeName.startsWith('icon:') ? 'text' : this.shapeName, spinSpeed = m === 'thinking' ? 1.4 : m === 'alert' ? 2 : .3;
    if (FACING[base]) this.spin += (Math.sin(t * .6) * .3 - this.spin) * .04; else this.spin += spinSpeed * dt;
    this.tilt += ((SHAPE_TILT[base] ?? .3) - this.tilt) * .04;
    const show = core.show || 0, music = core.musicLevel || 0, mic = core.micLevel || 0;
    const pu = this.points.material.uniforms; pu.uTime.value = t; pu.uSpin.value = this.spin; pu.uTilt.value = this.tilt; pu.uRadius.value = 300 + 95 * show; pu.uDim.value += (((hud && hud.S.focus) || (hud && hud.S.drawer) ? .3 : 1) - pu.uDim.value) * .08; pu.uShow.value = show; pu.uMode.value = mode; pu.uA.value = A; pu.uB.value = B; pu.uPR.value = this.renderer.getPixelRatio(); pu.uMusic.value = music;
    /* orb follows the avatar anchor (hud exposes the wander offsets) */
    const wd = hud && hud.WD || { ox: 0, oy: 0, os: 1 };
    this.speechLevel = this.speech();
    const energy = m === 'listening' ? .55 + mic * .5 : m === 'speaking' ? .6 + this.speechLevel * .6 : m === 'thinking' ? .7 : m === 'alert' ? 1 : .45 + music * .5;
    this.energy += (energy - this.energy) * .08;
    const sc = (wd.os || 1) * (1 + this.speechLevel * .12 + music * .06);
    this.orb.position.set(wd.ox || 0, -(wd.oy || 0), 40); this.orb.scale.set(sc, sc, sc);
    const ou = this.orb.material.uniforms; ou.uTime.value = t; ou.uA.value = A; ou.uB.value = B; ou.uRed.value = red; ou.uTalk.value = this.speechLevel; ou.uEnergy.value = this.energy;
    /* avatar: the orb, the robot face (DOM layer, orb hidden) or the VRM avatar (loaded on demand, orb hidden once it is in) */
    const av = SAM.face ? SAM.face.effective() : 'orb';
    if (av === 'vrm') { if (!this.vrm && !this.vrmLoading && this.vrmFailed !== SAM.face.vrmUrl()) this.loadVrm(); else if (this.vrm && this.vrm.url !== SAM.face.vrmUrl()) this.disposeVrm(); }
    else if (this.vrm || this.vrmLoading) { this.disposeVrm(); this.vrmLoading = ''; }
    const vrmOn = av === 'vrm' && !!this.vrm; this.orb.visible = av === 'orb' || (av === 'vrm' && !vrmOn);
    if (vrmOn) this.updateVrm(dt, t);
    pu.uCenter.value.z += ((vrmOn ? -520 : 0) - pu.uCenter.value.z) * .08;                      // the particle field moves behind the bust
    this.halo.position.copy(this.orb.position); if (vrmOn) { this.halo.position.set(0, -40, -260); } const hs = 330 * sc * (vrmOn ? 2.2 : 1) * (1 + this.speechLevel * .25 + music * .3); this.halo.scale.set(hs, hs, 1); this.halo.material.color = red ? new THREE.Color(1, .24, .43) : (mode === 1 ? B : A); this.halo.material.opacity = (vrmOn ? .22 : .35) + .35 * this.energy;
    const nu = this.nebula.material.uniforms; nu.uTime.value = t; nu.uA.value = A; nu.uB.value = B; nu.uRed.value += (red - nu.uRed.value) * .06; nu.uEnergy.value += (this.energy - nu.uEnergy.value) * .05; nu.uStir.value = m === 'alert' ? .6 : m === 'thinking' ? .35 : .15 + music * .3;
    this.glitch = Math.max(0, this.glitch - dt * 1.5); nu.uGlitch.value = this.glitch;
    if (this.bloom) this.bloom.strength = .45 + .4 * this.energy + .35 * music;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  },
  pulse() { this.glitch = 1; },
  async report() {                                                     // tell the control panel which GPU the browser really uses, and how it performs
    if (!this.on) return;
    try {
      const r = await (await fetch(SAM.H + ':9000/tune/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renderer: this.renderer_name, vendor: this.vendor_name, fps: Math.round(this.fps), quality: this.quality }) })).json();
      const hud = SAM.hud; if (hud) { hud.S.gpuWarning = r.warning || ''; if (r.warning) hud.log('warn', 'gpu · ' + r.warning); else hud.log('ok', `gpu · ${this.renderer_name.slice(0, 50)} · ${Math.round(this.fps)} fps`); }
    } catch (e) { }
  },

  /* holographic globe for the position widget: wireframe sphere, graticule, your marker; renders only while visible */
  globe(canvas, lat, lon) {
    if (canvas.__globe) { canvas.__globe.set(lat, lon); return canvas.__globe; }
    const w = canvas.clientWidth || 240, h = canvas.clientHeight || 170, r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); r.setPixelRatio(1); r.setSize(w, h, false); r.setClearColor(0, 0);
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, w / h, 1, 100); cam.position.set(0, 0, 7.2);
    const A = rgb(SAM.core.THEME.c), B = rgb(SAM.core.THEME.v), group = new THREE.Group(); sc.add(group);
    group.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(2, 24, 16)), new THREE.LineBasicMaterial({ color: A, transparent: true, opacity: .28 })));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.98, 32, 24), new THREE.MeshBasicMaterial({ color: B, transparent: true, opacity: .07 })));
    const eq = new THREE.Mesh(new THREE.TorusGeometry(2.02, .012, 6, 90), new THREE.MeshBasicMaterial({ color: A, transparent: true, opacity: .6 })); eq.rotation.x = Math.PI / 2; group.add(eq);
    const dots = []; for (let i = 0; i < 260; i++) { const la = (Math.random() - .5) * Math.PI * .9, lo = Math.random() * 6.283; dots.push(2.01 * Math.cos(la) * Math.cos(lo), 2.01 * Math.sin(la), 2.01 * Math.cos(la) * Math.sin(lo)); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)); group.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: A, size: .045, transparent: true, opacity: .7 })));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffb84d })); group.add(marker);
    const ringM = new THREE.Mesh(new THREE.RingGeometry(.1, .14, 32), new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: .8, side: THREE.DoubleSide })); group.add(ringM);
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.6, .008, 6, 120), new THREE.MeshBasicMaterial({ color: A, transparent: true, opacity: .35 })); orbit.rotation.x = 1.2; orbit.rotation.y = .4; sc.add(orbit);
    const sat = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); sc.add(sat);
    const G = { raf: 0, lat, lon, set(la, lo) { this.lat = la; this.lon = lo; }, stop() { cancelAnimationFrame(this.raf); r.dispose(); canvas.__globe = null; } };
    const loop = ts => {
      if (!canvas.isConnected) { G.stop(); return; }
      const t = ts / 1000, la = G.lat * Math.PI / 180, lo = -G.lon * Math.PI / 180;
      marker.position.set(2.02 * Math.cos(la) * Math.cos(lo), 2.02 * Math.sin(la), 2.02 * Math.cos(la) * Math.sin(lo)); ringM.position.copy(marker.position).multiplyScalar(1.01); ringM.lookAt(0, 0, 0); ringM.scale.setScalar(1 + .25 * Math.sin(t * 3));
      group.rotation.y = t * .25 - lo - Math.PI / 2 * 0; group.rotation.x = .25;
      sat.position.set(2.6 * Math.cos(t * .9), 2.6 * Math.sin(t * .9) * Math.sin(1.2), 2.6 * Math.sin(t * .9) * Math.cos(1.2)); sat.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), .4);
      if (canvas.offsetParent !== null) r.render(sc, cam); G.raf = requestAnimationFrame(loop);
    };
    G.raf = requestAnimationFrame(loop); canvas.__globe = G; return G;
  },
};
SAM.gl = gl;
/* auto-start once the HUD exists: respects the settings switch (S.gl = auto | on | off) and drops back to 2D when slow */
(function boot() {
  if (!SAM.hud || !SAM.hud.S) return setTimeout(boot, 50);
  const S = SAM.hud.S, pref = new URLSearchParams(location.search).get('gl') || S.gl || 'auto'; if (pref === 'off' || S.reduced) return;
  const q = S.glQuality || (pref === 'auto' ? 'medium' : 'high');
  if (!gl.enable(q)) return;
  if (pref === 'auto') setTimeout(() => { if (gl.on && gl.fps < 18 && q !== 'low') { gl.setQuality('low'); SAM.hud.log && SAM.hud.log('info', '3D core → low quality (slow GPU)'); } }, 6000);
})();
