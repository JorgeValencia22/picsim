/**
 * Dinámica de vuelo de 6 grados de libertad de una aeronave RC.
 *
 * - Sólido rígido con masa, tensor de inercia diagonal (ejes principales aproximados),
 *   velocidad lineal y angular, orientación con cuaterniones.
 * - Fuerzas: aerodinámica por paneles (AeroModel), empuje, par motor, giroscópico,
 *   gravedad, contacto con el terreno (resorte-amortiguador con fricción), colisiones con
 *   objetos (impulsos), agua (flotación y arrastre) y fuerzas externas (lanzamiento asistido).
 * - Integración semiimplícita (Euler simpléctico) con paso fijo, que garantiza que la física
 *   no dependa de los FPS. Ecuaciones de Euler para la rotación: I·ω̇ = M − ω×(I·ω) − ω×H_rotor.
 * - Daños por impacto con consecuencias funcionales (sustentación, controles, tren, hélice).
 */
import { Vec3, Quat, clamp, attitudeFromQuat, moveTowards, DEG } from '../utils/math3d.js';
import { buildAeroModel, evaluateAero, makeAeroOut, freshDamage, FIDELITY, toBody } from './AeroModel.js';
import { Propulsion } from './Propulsion.js';

const G = 9.80665;

const _v = new Vec3(), _w = new Vec3(), _r = new Vec3(), _n = new Vec3(), _t = new Vec3(), _f = new Vec3();
const _tmp = new Vec3(), _tmp2 = new Vec3(), _fw = new Vec3(), _lat = new Vec3();
const _Fw = new Vec3(), _Mw = new Vec3(), _cross = new Vec3();

export class AircraftPhysics {
  /**
   * @param {object} spec  spec completo (AircraftRegistry)
   * @param {object} opts  { fidelity: 'arcade'|'casual'|'realistic'|'expert', damage: bool, seed }
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.fidelityKey = opts.fidelity || 'realistic';
    this.fid = FIDELITY[this.fidelityKey];
    this.damageEnabled = opts.damage !== false;
    this.model = buildAeroModel(spec, spec.cgX, { seed: opts.seed ?? 99, asym: this.fid.asym });
    this.engine = new Propulsion(spec.prop, opts.seed ?? 7);

    this.mass = spec.mass;
    this.I = new Vec3(spec.inertia.xx, spec.inertia.yy, spec.inertia.zz);

    // estado
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.q = new Quat();
    this.omega = new Vec3(); // ejes del cuerpo
    this.prevPos = new Vec3();
    this.prevQ = new Quat();

    // órdenes (entrada) y deflexiones reales de los servos (fracciones -1..1)
    this.cmd = { aileron: 0, elevator: 0, rudder: 0, throttle: 0, flap: 0, airbrake: 0, brake: 0, gearDown: true };
    this.defl = { aileron: 0, elevator: 0, rudder: 0, flap: 0, airbrake: 0 };
    this.gearPos = 1;

    this.damage = freshDamage();
    this.destroyed = false;
    this.inWater = false;
    this.held = null; // { pos: Vec3, q: Quat } → aeronave sostenida (lanzamiento a mano)
    this.extForces = []; // [{ r: Vec3 (cuerpo), f: Vec3 (mundo) }]
    this.events = [];
    this.time = 0;

    this._aero = makeAeroOut();
    this._ctx = {
      v: new Vec3(), omega: this.omega, wind: new Vec3(), windGrad: new Vec3(), rho: 1.225,
      defl: this.defl, slip: 0, agl: 100, upB: new Vec3(), damage: this.damage, gearPos: 1, fid: this.fid,
    };

    // puntos de contacto en ejes del cuerpo
    const W = this.mass * G;
    const cgX = spec.cgX;
    const gearCount = Math.max(1, spec.gearPoints.length);
    const mkPoint = (p, kind) => {
      const r = toBody(p.x, p.y, p.z, cgX);
      // masa efectiva vertical en el punto (para un amortiguamiento bien dimensionado)
      const invMeff = 1 / this.mass + (r.z * r.z) / this.I.x + (r.x * r.x) / this.I.z;
      const meff = 1 / invMeff;
      const isAir = kind === 'airframe';
      const k = isAir ? (W / 0.02) * 1.5 : W / (0.016 * gearCount * 0.6);
      const c = 2 * (isAir ? 0.9 : 0.55) * Math.sqrt(k * Math.min(meff, this.mass / gearCount));
      return { ...p, r, kind: p.kind || kind, k, c, contact: false, compress: 0, lastImpact: 0, spin: 0 };
    };
    this.gearPoints = spec.gearPoints.map((p) => mkPoint(p, p.kind));
    this.airPoints = spec.airframePoints.map((p) => mkPoint(p, 'airframe'));
    this.allPoints = [...this.gearPoints, ...this.airPoints];

    this.telemetry = {
      airspeed: 0, groundSpeed: 0, alpha: 0, beta: 0, agl: 0, altitude: 0, vs: 0, gLoad: 1,
      heading: 0, pitch: 0, bank: 0, stall: 0, onGround: false, wheelsOnGround: 0, wingCL: 0,
      throttle: 0, rpm: 0, thrust: 0, windSpeed: 0, upY: 1, gearDown: true,
    };
    this._att = {};
    this.restHeight = 0;
  }

  /** Coloca la aeronave. Si onGround, la apoya sobre el tren con la actitud de reposo. */
  resetTo(world, { x, z, y = null, heading = 0, pitch = 0, bank = 0, speed = 0, onGround = false }) {
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.damage = Object.assign(this.damage, freshDamage());
    this._ctx.damage = this.damage;
    this.destroyed = false;
    this.inWater = false;
    this.held = null;
    this.extForces.length = 0;
    this.engine.reset();
    this.cmd.throttle = 0;
    this.defl.aileron = this.defl.elevator = this.defl.rudder = 0;
    this.gearPos = 1;
    this.cmd.gearDown = true;
    for (const p of this.allPoints) { p.contact = false; p.compress = 0; }

    if (onGround) {
      const restPitch = this.restPitch();
      this.q.setFromHeadingPitchBank(heading, restPitch, 0);
      const h = world.heightAt(x, z);
      let minY = Infinity;
      const pts = this.gearPoints.length ? this.gearPoints : this.airPoints;
      for (const p of pts) {
        _r.copy(p.r).applyQuat(this.q);
        minY = Math.min(minY, _r.y);
      }
      this.pos.set(x, h - minY + 0.004, z);
    } else {
      this.q.setFromHeadingPitchBank(heading, pitch, bank);
      this.pos.set(x, y, z);
      _f.set(Math.cos(pitch) * Math.sin(heading), Math.sin(pitch), -Math.cos(pitch) * Math.cos(heading));
      this.vel.copy(_f).scale(speed);
    }
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
    this.computeRestHeight();
    this.updateTelemetry(world, 0);
  }

  /** Cabeceo de reposo en tierra (3 puntos en patín de cola). */
  restPitch() {
    const pts = this.gearPoints;
    const tail = pts.find((p) => p.role === 'tail' && p.kind === 'wheel');
    const main = pts.find((p) => p.role === 'main');
    // línea de suelo que pasa por la rueda principal y la de cola
    if (tail && main) return Math.atan2(tail.r.y - main.r.y, main.r.x - tail.r.x);
    return 0;
  }

  computeRestHeight() {
    let minY = 0;
    for (const p of this.gearPoints) minY = Math.min(minY, p.r.y);
    if (!this.gearPoints.length) for (const p of this.airPoints) minY = Math.min(minY, p.r.y);
    this.restHeight = -minY;
  }

  /** Sostener la aeronave en una posición (lanzamiento a mano / lanzador). */
  hold(pos, q) {
    this.held = { pos: pos.clone(), q: q.clone() };
    this.pos.copy(pos);
    this.q.copy(q);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
  }

  /** Suelta la aeronave con una velocidad inicial (mundo). */
  release(velocity) {
    this.held = null;
    this.vel.copy(velocity);
    this.events.push({ type: 'launch' });
  }

  /** Aplica una fuerza externa (mundo) en un punto del cuerpo durante el próximo paso. */
  addExternalForce(rBody, fWorld) {
    this.extForces.push({ r: rBody, f: fWorld });
  }

  /**
   * Paso de integración fijo.
   * @param {number} dt
   * @param {object} world  interfaz del entorno (terreno, viento, densidad, colisiones, agua)
   */
  step(dt, world) {
    this.prevPos.copy(this.pos);
    this.prevQ.copy(this.q);
    this.time += dt;
    const spec = this.spec;
    const cmd = this.cmd;

    // ── servos (velocidad limitada) — sin control si la aeronave está destruida o sin señal
    const alive = !this.destroyed;
    const rate = (spec.servo / 22) * dt;
    // trimado de fábrica (compensa el par motor a crucero) + trims de la emisora del piloto
    const tr = spec.trim || { aileron: 0, elevator: 0, rudder: 0 }, ut = cmd.trim || { aileron: 0, elevator: 0, rudder: 0 };
    this.defl.aileron = moveTowards(this.defl.aileron, alive ? clamp(cmd.aileron + tr.aileron + ut.aileron, -1, 1) : this.defl.aileron, rate);
    this.defl.elevator = moveTowards(this.defl.elevator, alive ? clamp(cmd.elevator + tr.elevator + ut.elevator, -1, 1) : this.defl.elevator, rate);
    this.defl.rudder = moveTowards(this.defl.rudder, alive ? clamp(cmd.rudder + tr.rudder + ut.rudder, -1, 1) : this.defl.rudder, rate);
    this.defl.flap = moveTowards(this.defl.flap, spec.hasFlaps ? clamp(cmd.flap, 0, 1) : 0, 0.8 * dt);
    this.defl.airbrake = moveTowards(this.defl.airbrake, spec.hasSpoilers ? clamp(cmd.airbrake, 0, 1) : 0, 1.5 * dt);
    if (spec.retract) this.gearPos = moveTowards(this.gearPos, cmd.gearDown ? 1 : 0, dt / 2.5);
    this._ctx.gearPos = spec.retract ? this.gearPos : 1;
    this._ctx.dt = dt;

    // ── aire relativo, viento y densidad
    const rho = world.density(this.pos.y);
    this._ctx.rho = rho;
    const windW = world.sampleWind(this.pos, _w);
    const windB = this._ctx.wind.copy(windW).applyQuatInv(this.q);
    // gradiente lateral del viento (turbulencia entre puntas → perturbaciones de alabeo)
    const halfSpan = spec.span / 2;
    _tmp.set(0, 0, halfSpan).applyQuat(this.q).add(this.pos);
    const wR = world.sampleWind(_tmp, _tmp2).applyQuatInv(this.q);
    const wRx = wR.x, wRy = wR.y, wRz = wR.z;
    _tmp.set(0, 0, -halfSpan).applyQuat(this.q).add(this.pos);
    const wL = world.sampleWind(_tmp, _tmp2).applyQuatInv(this.q);
    this._ctx.windGrad.set((wRx - wL.x) / spec.span, (wRy - wL.y) / spec.span, (wRz - wL.z) / spec.span);

    const vB = this._ctx.v.copy(this.vel).applyQuatInv(this.q);
    const axial = vB.x - windB.x;

    // ── motor
    const throttle = alive && !this.inWater ? clamp(cmd.throttle, 0, 1) : 0;
    this.engine.health = this.damage.prop;
    this.engine.update(dt, throttle, axial, rho, world.temperature ?? 15);
    this._ctx.slip = this.engine.slipstream;

    if (this.held) {
      this.pos.copy(this.held.pos);
      this.q.copy(this.held.q);
      this.vel.set(0, 0, 0);
      this.omega.set(0, 0, 0);
      this.updateTelemetry(world, dt);
      this.extForces.length = 0;
      return;
    }

    // ── aerodinámica
    const groundH = world.heightAt(this.pos.x, this.pos.z);
    this._ctx.agl = this.pos.y - groundH - this.restHeight;
    this._ctx.upB.set(0, 1, 0).applyQuatInv(this.q);
    const aero = evaluateAero(this.model, this._ctx, this._aero);

    // fuerza y momento totales en ejes del cuerpo
    const Fb = _f.copy(aero.force);
    const Mb = _t.copy(aero.moment);

    // ── empuje, par de reacción y giroscópico
    const thrust = this.engine.thrust;
    if (thrust !== 0) {
      const td = this.model.thrustDir, tp = this.model.propPos;
      const fx = td.x * thrust, fy = td.y * thrust, fz = td.z * thrust;
      Fb.x += fx; Fb.y += fy; Fb.z += fz;
      Mb.x += tp.y * fz - tp.z * fy;
      Mb.y += tp.z * fx - tp.x * fz;
      Mb.z += tp.x * fy - tp.y * fx;
    }
    if (this.engine.hasProp) Mb.x -= this.engine.torque * this.fid.torque;
    const H = this.engine.angularMomentum * this.fid.gyro; // a lo largo de +X
    // −ω × H  (H = (H,0,0)):  ω×H = (0, ωz·H, −ωy·H)
    Mb.y -= this.omega.z * H;
    Mb.z += this.omega.y * H;

    // amortiguamiento artificial (sólo en niveles arcade/casual)
    const ed = this.fid.extraDamping;
    if (ed > 0) {
      Mb.x -= ed * this.I.x * this.omega.x;
      Mb.y -= ed * this.I.y * this.omega.y;
      Mb.z -= ed * this.I.z * this.omega.z;
    }

    // ── a ejes mundo
    const Fw = _Fw.copy(Fb).applyQuat(this.q);
    Fw.y -= this.mass * G;
    const Mw = _Mw.copy(Mb).applyQuat(this.q); // momentos acumulados en mundo

    // fuerzas externas (gancho de lanzamiento, etc.)
    for (const e of this.extForces) {
      Fw.add(e.f);
      _r.copy(e.r).applyQuat(this.q);
      _n.crossVectors(_r, e.f);
      Mw.add(_n);
    }
    this.extForces.length = 0;

    // ── contactos con el terreno y el agua
    const contactInfo = this.processContacts(dt, world, Fw, Mw);

    // ── integración (Euler semiimplícito)
    const invM = 1 / this.mass;
    this.vel.addScaled(Fw, invM * dt);
    this.pos.addScaled(this.vel, dt);

    const MbFinal = Mw.applyQuatInv(this.q);
    const I = this.I, w = this.omega;
    // ecuaciones de Euler (inercia diagonal)
    const ax = (MbFinal.x - (I.z - I.y) * w.y * w.z) / I.x;
    const ay = (MbFinal.y - (I.x - I.z) * w.z * w.x) / I.y;
    const az = (MbFinal.z - (I.y - I.x) * w.x * w.y) / I.z;
    w.x += ax * dt; w.y += ay * dt; w.z += az * dt;
    // límites de seguridad numérica (muy por encima de cualquier giro físico de un RC)
    const wm = w.length();
    if (wm > 45) w.scale(45 / wm);
    const vm = this.vel.length();
    if (vm > 220) this.vel.scale(220 / vm);
    this.q.integrateBody(w.x, w.y, w.z, dt);

    // ── colisiones con objetos (árboles, edificios...)
    if (world.collision) this.processObjectCollisions(world);

    // ── salvaguarda numérica
    if (!this.pos.isFinite() || !this.vel.isFinite() || !this.q.isFinite() || !w.isFinite()) {
      this.pos.copy(this.prevPos);
      this.q.copy(this.prevQ);
      this.vel.set(0, 0, 0);
      w.set(0, 0, 0);
      this.events.push({ type: 'numeric' });
    }

    this._lastAccel = Fw; // incluye gravedad
    this.checkOverstress(dt);
    this.updateTelemetry(world, dt, contactInfo);
  }

  /** Contactos resorte-amortiguador con fricción; también detecta impactos y daños. */
  processContacts(dt, world, Fw, Mw) {
    const fid = this.fid;
    const ds = this.damageEnabled ? fid.damageScale : Infinity;
    let wheelsOnGround = 0, anyContact = false;
    const omegaW = _n.copy(this.omega).applyQuat(this.q);
    const retracted = this.spec.retract && this.gearPos < 0.6;
    const gearBroken = this.damage.gear < 0.35;

    for (let i = 0; i < this.allPoints.length; i++) {
      const p = this.allPoints[i];
      const isWheel = p.kind === 'wheel';
      const isGear = p.kind === 'wheel' || p.kind === 'skid';
      if (isGear && ((p.retract && retracted) || (isWheel && gearBroken))) { p.contact = false; continue; }

      const rW = _r.copy(p.r).applyQuat(this.q);
      const px = this.pos.x + rW.x, py = this.pos.y + rW.y, pz = this.pos.z + rW.z;
      const h = world.heightAt(px, pz);

      // agua (mar o lagos)
      const water = world.waterLevelAt ? world.waterLevelAt(px, pz) : null;
      if (water != null && py < water) {
        this.handleWater(p, rW, water - py, omegaW, Fw, Mw, dt);
        anyContact = true;
        continue;
      }
      if (py > h + 0.5) { p.contact = false; p.compress = 0; continue; }
      const nrm = world.normalAt(px, pz, _lat);
      const depth = (h - py) * nrm.y;
      if (depth <= 0) { p.contact = false; p.compress = 0; continue; }

      // velocidad del punto: v + ω × r
      const vp = _v.crossVectors(omegaW, rW).add(this.vel);
      const vn = vp.x * nrm.x + vp.y * nrm.y + vp.z * nrm.z;
      const surf = world.surfaceAt(px, pz);

      // impacto (transición a contacto)
      if (!p.contact) {
        const vt = Math.sqrt(Math.max(0, vp.lengthSq() - vn * vn));
        this.onImpact(p, -vn, vt, ds, surf);
      }
      p.contact = true;
      p.compress = depth;
      anyContact = true;

      let fn = p.k * depth - p.c * vn;
      // tope del recorrido: más rígido si el amortiguador hace tope
      if (depth > 0.06) fn += p.k * 6 * (depth - 0.06);
      if (fn < 0) fn = 0;
      _f.copy(nrm).scale(fn);

      // fricción
      const vnx = nrm.x * vn, vny = nrm.y * vn, vnz = nrm.z * vn;
      const tx = vp.x - vnx, ty = vp.y - vny, tz = vp.z - vnz;
      if (isWheel) {
        wheelsOnGround++;
        // eje de rodadura: +X del cuerpo girado por la dirección (timón)
        let steer = 0;
        if (p.steer) steer = -this.defl.rudder * p.steer * DEG;
        _fw.set(Math.cos(steer), 0, Math.sin(-steer)).applyQuat(this.q);
        const dn = _fw.dot(nrm);
        _fw.addScaled(nrm, -dn).normalize();
        const latX = nrm.y * _fw.z - nrm.z * _fw.y;
        const latY = nrm.z * _fw.x - nrm.x * _fw.z;
        const latZ = nrm.x * _fw.y - nrm.y * _fw.x;
        const vf = tx * _fw.x + ty * _fw.y + tz * _fw.z;
        const vl = tx * latX + ty * latY + tz * latZ;
        let mu = surf.rolling + (p.brake ? this.cmd.brake * 0.55 : 0);
        if (this.damage.gear < 0.7) mu += (0.7 - this.damage.gear) * 0.6;
        const ff = -mu * fn * Math.tanh(vf / 0.25);
        const muLat = surf.grip * fid.groundGrip;
        const fl = -muLat * fn * Math.tanh(vl / 0.2);
        _f.x += _fw.x * ff + latX * fl;
        _f.y += _fw.y * ff + latY * fl;
        _f.z += _fw.z * ff + latZ * fl;
        p.spin = vf / Math.max(0.01, p.radius || 0.03);
        // bache del terreno irregular: pequeñas perturbaciones verticales proporcionales a la velocidad
        if (surf.rough > 0) {
          const bump = Math.sin(px * 7.3 + pz * 5.1) * Math.sin(px * 3.1 - pz * 8.7);
          _f.addScaled(nrm, bump * surf.rough * fn * clamp(Math.abs(vf) / 10, 0, 1));
        }
      } else {
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (vt > 1e-4) {
          const mu = surf.friction * (p.belly || p.kind === 'skid' ? 1 : 1.2);
          const ft = (-mu * fn * Math.tanh(vt / 0.25)) / vt;
          _f.x += tx * ft; _f.y += ty * ft; _f.z += tz * ft;
        }
        // roce continuo de la célula a velocidad → daño progresivo
        if (p.kind === 'airframe' && !p.belly && vt > 4 && this.damageEnabled) {
          this.applyDamage(p.group, ((vt - 4) * 0.012 * dt * 60) / ds, false);
        }
        if (p.group === 'prop' && this.engine.r > 0.1 && this.damageEnabled) {
          this.applyDamage('prop', (1.2 * dt) / ds, false);
          if ((this.engine.type === 'glow2' || this.engine.type === 'glow4' || this.engine.type === 'gas') && this.damage.prop < 0.6) this.engine.running = false;
        }
      }

      Fw.add(_f);
      Mw.add(_cross.crossVectors(rW, _f));
    }
    return { wheelsOnGround, anyContact };
  }

  handleWater(p, rW, depth, omegaW, Fw, Mw, dt) {
    if (!this.inWater) {
      this.inWater = true;
      const vy = this.vel.y;
      this.events.push({ type: 'splash', speed: this.vel.length() });
      if (this.damageEnabled && this.vel.length() > 14 * this.fid.damageScale) this.destroy('water');
      this.engine.running = this.engine.type === 'electric' || this.engine.type === 'edf' ? this.engine.running : false;
      if (vy < -3) this.applyDamage('fuselage', 0.2, true);
    }
    const vp = _v.crossVectors(omegaW, rW).add(this.vel);
    const share = this.mass / this.allPoints.length;
    // flotación + arrastre hidrodinámico fuerte
    _f.set(0, Math.min(depth, 0.15) * share * G * 30, 0);
    _f.addScaled(vp, -share * 6);
    Fw.add(_f);
    Mw.add(_cross.crossVectors(rW, _f));
  }

  onImpact(p, vn, vt, ds, surf) {
    if (vn <= 0.3) return;
    const isWheel = p.kind === 'wheel';
    this.events.push({ type: 'contact', point: p.id, kind: p.kind, role: p.role, vn, vt, surface: surf.type });
    if (!this.damageEnabled) return;
    const scale = this.spec.category === 'trainer' && this.spec.mass < 1.5 ? 1.35 : 1; // espuma: más resistente
    const k = ds * scale;
    if (isWheel) {
      const strength = 2.6 * k;
      if (vn > strength) {
        this.applyDamage('gear', (vn - strength) / (2.5 * k), true);
        this.events.push({ type: 'hardLanding', vn });
      }
      return;
    }
    if (p.kind === 'skid') {
      if (vn > 3.2 * k) this.applyDamage('fuselage', (vn - 3.2 * k) / (8 * k), true);
      return;
    }
    const impact = vn + 0.2 * vt;
    if (p.group === 'prop') {
      if (this.engine.r > 0.08) this.applyDamage('prop', 0.25 + impact * 0.05, true);
      return;
    }
    if (p.belly) {
      if (impact > 3.5 * k) this.applyDamage('fuselage', (impact - 3.5 * k) / (10 * k), true);
      return;
    }
    const threshold = (p.group === 'fuselage' ? 3.8 : 2.8) * k;
    if (impact > threshold) this.applyDamage(p.group, (impact - threshold) / (6 * k), true);
    if (vn > 13 * k) this.destroy('impact');
  }

  /** Aplica daño a un grupo (0..1 de pérdida). */
  applyDamage(group, amount, notify) {
    if (!this.damageEnabled || amount <= 0) return;
    const d = this.damage;
    if (d[group] == null) return;
    const before = d[group];
    d[group] = clamp(d[group] - amount, 0, 1);
    if (group === 'wingL' && d.wingL < 0.25 && !d.lostWingL) { d.lostWingL = true; this.events.push({ type: 'partLost', part: 'wingL' }); }
    if (group === 'wingR' && d.wingR < 0.25 && !d.lostWingR) { d.lostWingR = true; this.events.push({ type: 'partLost', part: 'wingR' }); }
    if (group === 'gear' && d.gear < 0.35 && before >= 0.35) this.events.push({ type: 'partLost', part: 'gear' });
    if (group === 'prop' && d.prop < 0.2 && before >= 0.2) this.events.push({ type: 'partLost', part: 'prop' });
    if (notify && before - d[group] > 0.02) this.events.push({ type: 'damage', group, amount: before - d[group] });
    if (d.fuselage <= 0.12 || (d.lostWingL && d.lostWingR)) this.destroy('structure');
  }

  destroy(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.engine.running = false;
    this.events.push({ type: 'destroyed', reason });
  }

  /**
   * Rotura estructural por exceso de carga (g): sobrepasar el límite de diseño daña las alas y,
   * muy por encima, las desprende. Sólo con daños activados.
   */
  checkOverstress(dt) {
    if (!this.damageEnabled || this.destroyed || !this._lastAccel) return;
    _tmp.copy(this._lastAccel);
    _tmp.y += this.mass * G;
    _tmp.applyQuatInv(this.q);
    const n = _tmp.y / (this.mass * G);
    const lim = (this.spec.gLimit || 12) * this.fid.damageScale;
    if (Math.abs(n) > lim) {
      this.overstressT = (this.overstressT || 0) + dt;
      if (this.overstressT > 0.06) {
        const k = ((Math.abs(n) - lim) / lim) * dt * 6;
        this.applyDamage('wingL', k, false);
        this.applyDamage('wingR', k * (0.8 + Math.random() * 0.4), false);
        if (!this.overstressWarned) { this.overstressWarned = true; this.events.push({ type: 'overstress', g: n }); }
      }
    } else { this.overstressT = 0; this.overstressWarned = false; }
  }

  /** Colisiones con objetos estáticos mediante impulsos (árboles, edificios, postes...). */
  processObjectCollisions(world) {
    const col = world.collision;
    if (!col.nearAny(this.pos, this.spec.span * 0.6 + 1)) return;
    const hit = this._hit || (this._hit = { depth: 0, normal: new Vec3(), soft: false, id: null });
    for (const p of this.allPoints) {
      const rW = _r.copy(p.r).applyQuat(this.q);
      _tmp.copy(this.pos).add(rW);
      if (!col.queryPoint(_tmp, hit)) continue;
      const omegaW = _n.copy(this.omega).applyQuat(this.q);
      const vp = _v.crossVectors(omegaW, rW).add(this.vel);
      if (hit.soft) {
        // copa de árbol: frenado intenso y daño leve
        const speed = vp.length();
        this.vel.scale(0.985);
        this.omega.scale(0.97);
        if (speed > 6 && this.damageEnabled) this.applyDamage(p.group === 'prop' ? 'prop' : (p.group || 'fuselage'), speed * 0.0015 / this.fid.damageScale, false);
        if (!this._inCanopy) { this._inCanopy = true; this.events.push({ type: 'collision', soft: true, speed, object: hit.id }); }
        continue;
      }
      const nrm = hit.normal;
      const vn = vp.dot(nrm);
      // corrección de posición
      this.pos.addScaled(nrm, hit.depth * 0.9);
      if (vn >= 0) continue;
      // impulso normal con restitución baja (respuesta rotacional incluida)
      const rB = _tmp2.copy(p.r);
      const nB = _fw.copy(nrm).applyQuatInv(this.q);
      const rxn = _lat.crossVectors(rB, nB);
      const ix = rxn.x / this.I.x, iy = rxn.y / this.I.y, iz = rxn.z / this.I.z;
      // k = 1/m + n·((I⁻¹(r×n)) × r)
      const cx = iy * rB.z - iz * rB.y, cy = iz * rB.x - ix * rB.z, cz = ix * rB.y - iy * rB.x;
      const kEff = 1 / this.mass + nB.x * cx + nB.y * cy + nB.z * cz;
      const j = (-(1 + 0.15) * vn) / kEff;
      this.vel.addScaled(nrm, j / this.mass);
      this.omega.x += ix * j; this.omega.y += iy * j; this.omega.z += iz * j;
      // fricción tangencial aproximada
      _tmp.copy(vp).addScaled(nrm, -vn);
      this.vel.addScaled(_tmp, -0.35);
      const impact = -vn;
      this.events.push({ type: 'collision', soft: false, speed: impact, object: hit.id });
      if (this.damageEnabled) {
        const k = this.fid.damageScale;
        if (impact > 2.5 * k) this.applyDamage(p.group === 'prop' ? 'prop' : p.group || 'fuselage', (impact - 2.5 * k) / (5 * k), true);
        if (impact > 12 * k) this.destroy('collision');
      }
    }
    this._inCanopy = false;
  }

  updateTelemetry(world, dt, contactInfo) {
    const t = this.telemetry;
    const att = attitudeFromQuat(this.q, this._att);
    const windNow = world.sampleWind(this.pos, _w);
    _v.copy(this.vel).sub(windNow);
    const air = _v.applyQuatInv(this.q);
    const V = air.length();
    t.airspeed = V;
    t.alpha = V > 0.5 ? Math.atan2(-air.y, air.x) : 0;
    t.beta = V > 0.5 ? Math.asin(clamp(air.z / V, -1, 1)) : 0;
    t.groundSpeed = Math.hypot(this.vel.x, this.vel.z);
    t.vs = this.vel.y;
    const gh = world.heightAt(this.pos.x, this.pos.z);
    t.agl = Math.max(0, this.pos.y - gh - this.restHeight);
    t.altitude = this.pos.y;
    t.heading = att.heading;
    t.pitch = att.pitch;
    t.bank = att.bank;
    t.upY = att.upY;
    t.stall = this._aero.stall;
    t.wingCL = this._aero.wingCL;
    t.throttle = this.cmd.throttle;
    t.rpm = this.engine.rpm;
    t.thrust = this.engine.thrust;
    t.gearDown = this.gearPos > 0.5;
    t.windSpeed = Math.hypot(windNow.x, windNow.z);
    t.windVertical = windNow.y;
    if (contactInfo) {
      t.onGround = contactInfo.anyContact;
      t.wheelsOnGround = contactInfo.wheelsOnGround;
    } else if (this.held) { t.onGround = false; t.wheelsOnGround = 0; }
    // factor de carga: (fuerzas no gravitatorias)/peso proyectadas en el eje vertical del cuerpo
    if (this._lastAccel && dt > 0) {
      _tmp.copy(this._lastAccel);
      _tmp.y += this.mass * G;
      _tmp.applyQuatInv(this.q);
      const g = _tmp.y / (this.mass * G);
      t.gLoad += (g - t.gLoad) * Math.min(1, dt * 12);
    }
  }

  /** Estado serializable (repeticiones / futura red). */
  snapshot() {
    return {
      p: [this.pos.x, this.pos.y, this.pos.z],
      q: [this.q.x, this.q.y, this.q.z, this.q.w],
      v: [this.vel.x, this.vel.y, this.vel.z],
      c: [this.defl.aileron, this.defl.elevator, this.defl.rudder, this.defl.flap, this.defl.airbrake],
      e: [this.engine.r, this.engine.angle],
      g: this.gearPos,
      d: { ...this.damage },
      x: this.destroyed,
    };
  }

  get bodyUp() { return new Vec3(0, 1, 0).applyQuat(this.q); }
  get bodyForward() { return new Vec3(1, 0, 0).applyQuat(this.q); }
}
