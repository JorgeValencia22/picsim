/**
 * Estadísticas locales persistentes: horas de vuelo, vuelos, distancia, tiempo en el aire,
 * aterrizajes, colisiones, maniobras, récords y uso por aeronave y escenario.
 */
export function emptyStats() {
  return {
    flights: 0, flightTime: 0, airTime: 0, distance: 0,
    landings: 0, perfectLandings: 0, crashes: 0, collisions: 0,
    maneuvers: {}, bestLanding: 0, bestManeuver: 0, longestFlight: 0, maxAltitude: 0, maxSpeed: 0,
    aircraft: {}, environments: {}, history: [],
  };
}

export class Statistics {
  constructor(storage) {
    this.storage = storage;
    this.data = { ...emptyStats(), ...(storage?.get('stats', null) || {}) };
    this.current = null;
  }

  save() { this.storage?.set('stats', this.data); }

  reset() {
    this.data = emptyStats();
    this.save();
  }

  /** Comienza el registro de un vuelo. */
  begin(aircraftId, aircraftName, envId, envName, mode = 'free') {
    this.end();
    this.current = {
      aircraft: aircraftId, aircraftName, env: envId, envName, mode,
      start: Date.now(), time: 0, airTime: 0, distance: 0, landings: 0, perfect: 0, bestLanding: 0,
      collisions: 0, crashed: false, maneuvers: 0, maxAlt: 0, maxSpeed: 0,
    };
  }

  /** Acumula datos por fotograma. */
  tick(dt, t, airborne, pos, lastPos) {
    const c = this.current;
    if (!c) return;
    c.time += dt;
    if (airborne) c.airTime += dt;
    if (pos && lastPos) {
      const d = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y, pos.z - lastPos.z);
      if (d < 50) c.distance += d;
    }
    c.maxAlt = Math.max(c.maxAlt, t.agl);
    c.maxSpeed = Math.max(c.maxSpeed, t.airspeed);
  }

  landing(result) {
    const c = this.current;
    if (!c || result.destroyed) return;
    c.landings++;
    if (result.perfect) c.perfect++;
    c.bestLanding = Math.max(c.bestLanding, result.score);
  }

  collision() { if (this.current) this.current.collisions++; }

  crash() { if (this.current) this.current.crashed = true; }

  maneuver(id, score) {
    if (!this.current) return;
    this.current.maneuvers++;
    this.data.maneuvers[id] = (this.data.maneuvers[id] || 0) + 1;
    this.data.bestManeuver = Math.max(this.data.bestManeuver, score || 0);
  }

  /** Cierra el vuelo actual y lo consolida (los vuelos de menos de 5 s no cuentan). */
  end() {
    const c = this.current;
    this.current = null;
    if (!c || c.time < 5) return null;
    const d = this.data;
    d.flights++;
    d.flightTime += c.time;
    d.airTime += c.airTime;
    d.distance += c.distance;
    d.landings += c.landings;
    d.perfectLandings += c.perfect;
    d.collisions += c.collisions;
    if (c.crashed) d.crashes++;
    d.bestLanding = Math.max(d.bestLanding, c.bestLanding);
    d.longestFlight = Math.max(d.longestFlight, c.airTime);
    d.maxAltitude = Math.max(d.maxAltitude, c.maxAlt);
    d.maxSpeed = Math.max(d.maxSpeed, c.maxSpeed);
    const a = (d.aircraft[c.aircraft] ||= { name: c.aircraftName, time: 0, flights: 0 });
    a.time += c.time; a.flights++; a.name = c.aircraftName;
    const e = (d.environments[c.env] ||= { name: c.envName, time: 0, flights: 0 });
    e.time += c.time; e.flights++; e.name = c.envName;
    d.history.unshift({
      date: c.start, aircraft: c.aircraftName, env: c.envName, time: Math.round(c.time), airTime: Math.round(c.airTime),
      distance: Math.round(c.distance), landings: c.landings, bestLanding: c.bestLanding, crashed: c.crashed, maneuvers: c.maneuvers, mode: c.mode,
    });
    d.history = d.history.slice(0, 30);
    this.save();
    return c;
  }

  /** Registro del mejor resultado de un desafío / lección. */
  record(kind, id, score, extra = {}) {
    const key = `${kind}Records`;
    const all = this.storage?.get(key, {}) || {};
    const prev = all[id];
    const better = !prev || score > prev.score;
    if (better) all[id] = { score, date: Date.now(), ...extra };
    this.storage?.set(key, all);
    return { better, prev };
  }

  records(kind) { return this.storage?.get(`${kind}Records`, {}) || {}; }

  topList(map, n = 5) {
    return Object.entries(map).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.time - a.time).slice(0, n);
  }
}
