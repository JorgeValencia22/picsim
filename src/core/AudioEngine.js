/**
 * Audio sintetizado con Web Audio API (sin archivos): motores eléctricos, glow, gasolina,
 * turbina y EDF cuyo timbre sigue a las RPM y la carga; flujo de aire, ruedas, impactos,
 * ambiente por escenario, lluvia, vario para planeadores e interfaz. Audio espacial con
 * PannerNode (HRTF), atenuación por distancia, efecto Doppler y reverberación ligera.
 * Buses independientes: motor, ambiente, efectos e interfaz.
 */
import { clamp } from '../utils/math3d.js';

const SPEED_OF_SOUND = 343;

function makeNoiseBuffer(ctx, seconds = 2, color = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (color === 'pink') { last = 0.97 * last + 0.03 * w; d[i] = (last * 4 + w * 0.3) * 0.6; }
    else d[i] = w;
  }
  return buf;
}

function impulse(ctx, seconds = 1.6, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class AudioEngine {
  constructor(settingsRef) {
    this.s = settingsRef; // settings.audio
    this.ctx = null;
    this.engine = null;
    this.ambience = null;
    this.enabled = false;
    this.paused = false;
  }

  /** Debe llamarse tras un gesto del usuario (política de reproducción automática). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = {};
    for (const b of ['engine', 'ambient', 'effects', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 1.4, 3.5);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.12;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.noise = makeNoiseBuffer(ctx, 2, 'white');
    this.pink = makeNoiseBuffer(ctx, 3, 'pink');
    this.brown = makeNoiseBuffer(ctx, 3, 'brown');
    this.enabled = true;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.s;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.buses.engine.gain.setTargetAtTime(s.engine, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(s.ambient, t, 0.05);
    this.buses.effects.gain.setTargetAtTime(s.effects, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.ui, t, 0.05);
    if (this.engine) this.engine.panner.panningModel = s.spatial ? 'HRTF' : 'equalpower';
  }

  noiseSource(buf = this.noise) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /* ─────────────────────────── voz del motor ─────────────────────────── */

  /** Crea la voz de motor de una aeronave (se destruye la anterior). */
  setAircraft(spec) {
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx;
    const type = spec.prop.type;
    const panner = ctx.createPanner();
    panner.panningModel = this.s.spatial ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(3, spec.span * 3);
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 3000;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(panner);
    panner.connect(this.buses.engine);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    panner.connect(send).connect(this.reverb);
    const v = { type, panner, out, oscs: [], nodes: [], spec };
    const osc = (wave, gain, filter) => {
      const o = ctx.createOscillator();
      o.type = wave;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      if (filter) { g.connect(filter); } else g.connect(out);
      o.start();
      v.oscs.push({ o, g, base: gain });
      return { o, g };
    };
    const lp = (freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
      f.connect(out);
      v.nodes.push(f);
      return f;
    };
    const bp = (freq, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      f.connect(out);
      v.nodes.push(f);
      return f;
    };
    const scale = clamp(spec.mass / 2, 0.5, 4); // aviones grandes: más graves y potentes
    v.scale = scale;
    if (type === 'electric') {
      v.whineF = lp(4000, 1);
      v.whine = osc('sawtooth', 0.05, v.whineF);
      v.whine2 = osc('square', 0.015, v.whineF);
      v.bladeF = lp(900, 1.2);
      v.blade = osc('triangle', 0.35, v.bladeF);
      v.bladeH = osc('sawtooth', 0.08, v.bladeF);
      v.windF = bp(700, 0.8);
      v.wind = this.noiseSource();
      v.windG = ctx.createGain(); v.windG.gain.value = 0;
      v.wind.connect(v.windG).connect(v.windF);
    } else if (type === 'glow2' || type === 'glow4' || type === 'gas') {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
      shaper.curve = curve;
      const f = lp(type === 'glow2' ? 3200 : 1600, 1.5);
      shaper.connect(f);
      v.nodes.push(shaper);
      v.fire = osc('sawtooth', 0.4, shaper);
      v.fire2 = osc('square', 0.18, shaper);
      v.fireF = f;
      v.bladeF = lp(800, 1);
      v.blade = osc('triangle', 0.25, v.bladeF);
      // aspereza: modulación de amplitud a la frecuencia de encendido
      v.am = ctx.createGain();
      v.am.gain.value = 0.5;
      v.amOsc = ctx.createOscillator();
      v.amOsc.type = 'sine';
      const amDepth = ctx.createGain();
      amDepth.gain.value = 0.35;
      v.amOsc.connect(amDepth).connect(v.am.gain);
      v.amOsc.start();
      out.disconnect();
      out.connect(v.am).connect(panner);
      v.windF = bp(900, 0.7);
      v.wind = this.noiseSource();
      v.windG = ctx.createGain(); v.windG.gain.value = 0;
      v.wind.connect(v.windG).connect(v.windF);
    } else if (type === 'turbine') {
      v.roarF = bp(500, 0.5);
      v.roar = this.noiseSource(this.pink);
      v.roarG = ctx.createGain(); v.roarG.gain.value = 0;
      v.roar.connect(v.roarG).connect(v.roarF);
      v.hissF = bp(4000, 1.2);
      v.hiss = this.noiseSource();
      v.hissG = ctx.createGain(); v.hissG.gain.value = 0;
      v.hiss.connect(v.hissG).connect(v.hissF);
      v.whineF = lp(9000, 2);
      v.whine = osc('sine', 0.06, v.whineF);
      v.whine2 = osc('sine', 0.03, v.whineF);
    } else if (type === 'edf') {
      v.whineF = bp(3000, 2);
      v.whine = osc('sawtooth', 0.12, v.whineF);
      v.hissF = bp(2500, 0.8);
      v.hiss = this.noiseSource();
      v.hissG = ctx.createGain(); v.hissG.gain.value = 0;
      v.hiss.connect(v.hissG).connect(v.hissF);
    }
    // flujo de aire sobre la célula (todas las aeronaves, incluidos planeadores)
    v.airF = ctx.createBiquadFilter();
    v.airF.type = 'bandpass'; v.airF.frequency.value = 600; v.airF.Q.value = 0.6;
    v.air = this.noiseSource(this.pink);
    v.airG = ctx.createGain(); v.airG.gain.value = 0;
    v.air.connect(v.airG).connect(v.airF).connect(panner);
    // rodadura
    v.rollF = ctx.createBiquadFilter();
    v.rollF.type = 'lowpass'; v.rollF.frequency.value = 300;
    v.roll = this.noiseSource(this.brown);
    v.rollG = ctx.createGain(); v.rollG.gain.value = 0;
    v.roll.connect(v.rollG).connect(v.rollF).connect(panner);
    this.engine = v;
  }

  stopEngine() {
    const v = this.engine;
    if (!v) return;
    try {
      for (const { o } of v.oscs) o.stop();
      for (const n of [v.wind, v.roar, v.hiss, v.air, v.roll, v.amOsc]) n?.stop();
      v.panner.disconnect();
    } catch { /* ya detenido */ }
    this.engine = null;
  }

  /* ─────────────────────────── ambiente ─────────────────────────── */

  setAmbience(kind, weather) {
    if (!this.ctx) return;
    this.stopAmbience();
    const ctx = this.ctx;
    const a = { kind, nodes: [], timer: 0 };
    // viento general
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 500;
    a.wind = this.noiseSource(this.brown);
    a.windG = ctx.createGain(); a.windG.gain.value = 0;
    a.wind.connect(a.windG).connect(wf).connect(this.buses.ambient);
    a.nodes.push(a.wind);
    if (kind === 'sea') {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      a.sea = this.noiseSource(this.pink);
      a.seaG = ctx.createGain(); a.seaG.gain.value = 0.15;
      a.sea.connect(a.seaG).connect(f).connect(this.buses.ambient);
      a.nodes.push(a.sea);
    }
    if (kind === 'town') {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 220;
      a.town = this.noiseSource(this.brown);
      const g = ctx.createGain(); g.gain.value = 0.06;
      a.town.connect(g).connect(f).connect(this.buses.ambient);
      a.nodes.push(a.town);
    }
    if (weather?.cfg.rain > 0.01) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 1200;
      a.rain = this.noiseSource();
      const g = ctx.createGain(); g.gain.value = 0.12 * weather.cfg.rain;
      a.rain.connect(g).connect(f).connect(this.buses.ambient);
      a.nodes.push(a.rain);
    }
    this.ambience = a;
  }

  stopAmbience() {
    if (!this.ambience) return;
    for (const n of this.ambience.nodes) { try { n.stop(); } catch { /* */ } }
    this.ambience = null;
  }

  /** Canto de pájaro sintetizado (barridos de seno). */
  chirp(volume = 0.05) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2500 + Math.random() * 2500;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.buses.ambient);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t0 = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t0 + 0.06);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.connect(g).connect(pan);
      o.start(t0);
      o.stop(t0 + 0.1);
    }
  }

  /* ─────────────────────────── actualización ─────────────────────────── */

  /**
   * @param {number} dt
   * @param {object} st { pos, vel, rpm, rpmFrac, throttle, thrust, airspeed, wheelSpeed, onGround, paused, windSpeed, vario, varioOn }
   * @param {THREE.Camera} cam
   */
  update(dt, st, cam) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const L = ctx.listener;
    // oyente en la cámara
    const p = cam.position;
    const fwd = cam.getWorldDirection(this._fwd || (this._fwd = p.clone()));
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
    this.lastPos = st.pos;
    const v = this.engine;
    if (v) {
      const pn = v.panner;
      if (pn.positionX) { pn.positionX.setTargetAtTime(st.pos.x, t, 0.02); pn.positionY.setTargetAtTime(st.pos.y, t, 0.02); pn.positionZ.setTargetAtTime(st.pos.z, t, 0.02); }
      else pn.setPosition(st.pos.x, st.pos.y, st.pos.z);
      // Doppler manual: factor por velocidad radial respecto a la cámara
      const dx = st.pos.x - p.x, dy = st.pos.y - p.y, dz = st.pos.z - p.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const vr = (st.vel.x * dx + st.vel.y * dy + st.vel.z * dz) / d;
      const dop = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + vr), 0.6, 1.6);
      const paused = st.paused || this.paused;
      const rpm = st.rpm * dop;
      const r = st.rpmFrac;
      const load = clamp(st.throttle * 0.6 + r * 0.4, 0, 1);
      const set = (param, val, tc = 0.03) => param.setTargetAtTime(val, t, tc);
      const hz = rpm / 60;
      const sc = v.scale;
      const blades = v.spec.prop.blades || 2;
      let level = 0;
      switch (v.type) {
        case 'electric':
          set(v.whine.o.frequency, Math.max(20, hz * 7));
          set(v.whine2.o.frequency, Math.max(20, hz * 14));
          set(v.blade.o.frequency, Math.max(10, hz * blades));
          set(v.bladeH.o.frequency, Math.max(10, hz * blades * 2));
          set(v.bladeF.frequency, 300 + r * 1400);
          set(v.windG.gain, r * r * 0.25);
          set(v.windF.frequency, 400 + r * 1500);
          level = clamp(r * 1.1, 0, 1) * (0.55 + load * 0.45) * 0.55;
          break;
        case 'glow2':
        case 'glow4':
        case 'gas': {
          const fire = hz * (v.type === 'glow4' ? 0.5 : 1);
          set(v.fire.o.frequency, Math.max(15, fire));
          set(v.fire2.o.frequency, Math.max(15, fire * 2.01));
          set(v.amOsc.frequency, Math.max(5, fire * 0.5));
          set(v.blade.o.frequency, Math.max(10, hz * blades));
          set(v.fireF.frequency, (v.type === 'glow2' ? 1500 : 700) + load * 2500 / sc);
          set(v.windG.gain, r * r * 0.2);
          level = (r > 0.02 ? 0.25 + r * 0.75 : 0) * (0.5 + load * 0.5) * 0.5;
          break;
        }
        case 'turbine':
          set(v.roarG.gain, r * r * 0.9);
          set(v.roarF.frequency, 300 + r * 600);
          set(v.hissG.gain, r * 0.35);
          set(v.hissF.frequency, 2500 + r * 4000);
          set(v.whine.o.frequency, 1500 + r * 6500 * dop);
          set(v.whine2.o.frequency, 2300 + r * 9000 * dop);
          level = r > 0.02 ? 0.25 + r * 0.6 : 0;
          break;
        case 'edf':
          set(v.whine.o.frequency, Math.max(50, hz * 12));
          set(v.whineF.frequency, Math.max(200, hz * 12));
          set(v.hissG.gain, r * 0.5);
          set(v.hissF.frequency, 1500 + r * 3000);
          level = r * 0.6;
          break;
        default: level = 0;
      }
      set(v.out.gain, paused ? 0 : level, 0.05);
      const air = clamp(st.airspeed / 40, 0, 1.5);
      set(v.airG.gain, paused ? 0 : air * air * 0.35);
      set(v.airF.frequency, 300 + air * 900);
      set(v.rollG.gain, paused || !st.onGround ? 0 : clamp(st.wheelSpeed / 15, 0, 1) * 0.6);
    }
    // ambiente
    const a = this.ambience;
    if (a) {
      a.windG.gain.setTargetAtTime(this.paused ? 0 : clamp(st.windSpeed / 12, 0, 1) * 0.25 + 0.02, t, 0.3);
      if (a.seaG) a.seaG.gain.setTargetAtTime(0.1 + 0.08 * Math.sin(t * 0.4) + 0.05 * Math.sin(t * 0.13), t, 0.5);
      a.timer -= dt;
      if (a.kind === 'meadow' && a.timer <= 0 && !this.paused) { this.chirp(0.035); a.timer = 2 + Math.random() * 6; }
      if (a.kind === 'mountain' && a.timer <= 0 && !this.paused) { if (Math.random() < 0.3) this.chirp(0.02); a.timer = 6 + Math.random() * 8; }
    }
    // vario sonoro (planeadores): pitidos más agudos y rápidos cuanto más se sube
    if (st.varioOn && !this.paused) {
      this.varioT = (this.varioT || 0) - dt;
      const vs = st.vario;
      if (vs > 0.25 && this.varioT <= 0) {
        this.beep(600 + vs * 180, 0.06, 0.05, 'effects', 'sine');
        this.varioT = clamp(0.5 - vs * 0.08, 0.12, 0.5);
      } else if (vs < -2.5 && this.varioT <= 0) {
        this.varioT = 1.2;
      }
    }
  }

  /* ─────────────────────────── efectos ─────────────────────────── */

  beep(freq, dur = 0.08, vol = 0.1, bus = 'ui', wave = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst({ dur = 0.3, vol = 0.5, freq = 800, type = 'lowpass', q = 0.7, pos = null, buf = this.noise, thump = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let dest = this.buses.effects;
    if (pos && this.lastPos) {
      // efecto situado en la posición de la aeronave (bus de efectos)
      const pn = ctx.createPanner();
      pn.panningModel = this.s.spatial ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 6;
      if (pn.positionX) { pn.positionX.value = this.lastPos.x; pn.positionY.value = this.lastPos.y; pn.positionZ.value = this.lastPos.z; }
      else pn.setPosition(this.lastPos.x, this.lastPos.y, this.lastPos.z);
      pn.connect(this.buses.effects);
      dest = pn;
    }
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    if (thump > 0) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
      og.gain.setValueAtTime(thump, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(og).connect(dest);
      o.start(t); o.stop(t + 0.3);
    }
  }

  play(name, intensity = 1) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'touchdown': this.burst({ dur: 0.18, vol: 0.25 * intensity, freq: 500, pos: true, thump: 0.3 * intensity }); break;
      case 'hardLanding': this.burst({ dur: 0.35, vol: 0.6, freq: 700, pos: true, thump: 0.7 }); break;
      case 'crash': this.burst({ dur: 1.0, vol: 0.9, freq: 1800, pos: true, thump: 1 }); this.burst({ dur: 0.6, vol: 0.5, freq: 4000, type: 'highpass', pos: true }); break;
      case 'damage': this.burst({ dur: 0.25, vol: 0.5, freq: 2500, type: 'bandpass', q: 2, pos: true }); break;
      case 'scrape': this.burst({ dur: 0.4, vol: 0.25, freq: 3000, type: 'bandpass', q: 1.5, pos: true }); break;
      case 'splash': this.burst({ dur: 0.9, vol: 0.6, freq: 1200, pos: true, thump: 0.3 }); break;
      case 'branch': this.burst({ dur: 0.5, vol: 0.35, freq: 2200, type: 'highpass', pos: true }); break;
      case 'gear': this.beep(180, 0.5, 0.05, 'effects', 'sawtooth'); break;
      case 'launch': this.burst({ dur: 0.4, vol: 0.2, freq: 900, type: 'bandpass' }); break;
      case 'ring': this.beep(880, 0.12, 0.12, 'effects'); setTimeout(() => this.beep(1320, 0.15, 0.12, 'effects'), 90); break;
      case 'maneuver': this.beep(660, 0.1, 0.08); setTimeout(() => this.beep(990, 0.12, 0.08), 80); break;
      case 'warning': this.beep(440, 0.18, 0.12, 'effects', 'square'); break;
      case 'success': [523, 659, 784].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 0.1), i * 110)); break;
      case 'fail': [392, 330].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, 0.1, 'ui', 'triangle'), i * 160)); break;
      case 'click': this.beep(1200, 0.035, 0.06); break;
      case 'hover': this.beep(1800, 0.02, 0.02); break;
      case 'back': this.beep(700, 0.05, 0.06); break;
      case 'step': this.beep(988, 0.1, 0.09); break;
      default: break;
    }
  }

  setPaused(p) {
    this.paused = p;
  }
}
