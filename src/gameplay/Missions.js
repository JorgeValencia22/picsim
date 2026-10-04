/**
 * Modo entrenamiento (8 lecciones con objetivos verificables) y modo desafíos (10 pruebas con
 * puntuación, medallas y récord personal). Las misiones sólo OBSERVAN el estado del vuelo;
 * nunca controlan el avión.
 *
 * Contexto que reciben en cada fotograma (ctx):
 *  { dt, time, t (telemetría), ac (física), input (sticks crudos), env, weather, maneuvers[],
 *    landing (resultado si hubo), events[], spawn }
 */
import { DEG, RAD, wrapPi, clamp } from '../utils/math3d.js';

const S = (es, en) => ({ es, en });

/* ───────────────────────────── utilidades ───────────────────────────── */

function sustained(st, key, cond, dt, need) {
  st[key] = cond ? (st[key] || 0) + dt : 0;
  return { done: st[key] >= need, progress: clamp((st[key] || 0) / need, 0, 1) };
}

function headingChange(st, t) {
  if (st.lastHdg == null) { st.lastHdg = t.heading; st.turned = 0; }
  st.turned += wrapPi(t.heading - st.lastHdg);
  st.lastHdg = t.heading;
  return st.turned * RAD;
}

/* ───────────────────────────── LECCIONES ───────────────────────────── */

export const LESSONS = [
  {
    id: 'l1', kind: 'lesson', difficulty: 1,
    title: S('Lección 1 · Controles básicos', 'Lesson 1 · Basic controls'),
    desc: S('Alerones, profundidad, timón y acelerador: qué hace cada mando y cómo responde el avión.', 'Ailerons, elevator, rudder and throttle: what each control does and how the aircraft responds.'),
    setup: { aircraft: 'skylark', environment: 'airfield', launch: 'air', air: { alt: 80, dist: 140 }, weather: { windSpeed: 1, gusts: 0, turbulence: 0, thermals: 0, sky: 'clear', timeOfDay: 11 }, throttle: 0.6 },
    steps: [
      { text: S('Mueve el stick de alerones a la DERECHA: el avión se inclina (alabeo) a la derecha.', 'Move the aileron stick RIGHT: the aircraft banks right.'), stick: ['aileron', 1], check: (c) => c.t.bank > 25 * DEG && c.t.bank < 100 * DEG && c.input.aileron > 0.2 },
      { text: S('Ahora alabea a la IZQUIERDA.', 'Now bank LEFT.'), stick: ['aileron', -1], check: (c) => c.t.bank < -25 * DEG && c.t.bank > -100 * DEG && c.input.aileron < -0.2 },
      { text: S('Nivela las alas y mantenlas así 2 segundos.', 'Level the wings and hold for 2 seconds.'), stick: ['aileron', 0], check: (c, st) => sustained(st, 'lv', Math.abs(c.t.bank) < 6 * DEG, c.dt, 2) },
      { text: S('Tira de la PROFUNDIDAD (stick hacia ti): el morro sube.', 'Pull the ELEVATOR (stick towards you): the nose rises.'), stick: ['elevator', 1], check: (c) => c.t.pitch > 12 * DEG && c.input.elevator > 0.2 },
      { text: S('Empuja la profundidad: el morro baja.', 'Push the elevator: the nose drops.'), stick: ['elevator', -1], check: (c) => c.t.pitch < -6 * DEG && c.input.elevator < -0.2 },
      { text: S('Pisa el TIMÓN a la derecha: el morro guiña sin apenas inclinarse.', 'Apply right RUDDER: the nose yaws with little bank.'), stick: ['rudder', 1], check: (c) => c.ac.omega.y < -0.25 },
      { text: S('Reduce el ACELERADOR por debajo del 30%: el avión empieza a descender.', 'Reduce THROTTLE below 30%: the aircraft starts to descend.'), stick: ['throttle', -1], check: (c) => c.input.throttle < 0.3 },
      { text: S('Acelerador a fondo: el avión gana velocidad y sube.', 'Full throttle: the aircraft speeds up and climbs.'), stick: ['throttle', 1], check: (c) => c.input.throttle > 0.95 },
      { text: S('Vuela recto y nivelado 5 segundos (alas niveladas, sin subir ni bajar).', 'Fly straight and level for 5 seconds.'), check: (c, st) => sustained(st, 'sl', Math.abs(c.t.bank) < 10 * DEG && Math.abs(c.t.vs) < 1.5, c.dt, 5) },
    ],
  },
  {
    id: 'l2', kind: 'lesson', difficulty: 1,
    title: S('Lección 2 · Despegue', 'Lesson 2 · Takeoff'),
    desc: S('Acelera por la pista manteniendo el eje con el timón, rota a la velocidad adecuada y asciende estable.', 'Accelerate along the runway holding the centreline with rudder, rotate at the right speed and climb out.'),
    setup: { aircraft: 'skylark', environment: 'airfield', launch: 'runway', weather: { windSpeed: 1.5, gusts: 0.1, turbulence: 0.05, thermals: 0, sky: 'clear', timeOfDay: 10 } },
    steps: [
      { text: S('Sube el acelerador al 100% de forma progresiva.', 'Advance the throttle smoothly to 100%.'), stick: ['throttle', 1], check: (c) => c.input.throttle > 0.95 },
      { text: S('Mantén el eje de la pista con el timón mientras ganas velocidad.', 'Keep the runway centreline with rudder while accelerating.'), stick: ['rudder', 0], check: (c, st) => {
        st.dev = Math.max(st.dev || 0, c.lateral ?? 0);
        return c.t.airspeed > c.ac.spec.perf.stallSpeed * 1.15;
      } },
      { text: S('Tira suavemente de la profundidad para despegar.', 'Gently pull the elevator to lift off.'), stick: ['elevator', 1], check: (c) => c.t.wheelsOnGround === 0 && c.t.agl > 1.5 },
      { text: S('Asciende hasta 30 m con las alas niveladas.', 'Climb to 30 m with wings level.'), check: (c) => c.t.agl > 30 && Math.abs(c.t.bank) < 20 * DEG },
      { text: S('Reduce al 60% y nivela el vuelo durante 3 s.', 'Reduce to 60% and level off for 3 s.'), stick: ['throttle', -1], check: (c, st) => sustained(st, 'lv', c.input.throttle < 0.7 && Math.abs(c.t.vs) < 1.5, c.dt, 3) },
    ],
  },
  {
    id: 'l3', kind: 'lesson', difficulty: 1,
    title: S('Lección 3 · Vuelo recto y nivelado', 'Lesson 3 · Straight and level'),
    desc: S('Mantén altitud y rumbo con pequeñas correcciones. Base de todo el pilotaje.', 'Hold altitude and heading with small corrections. The foundation of all flying.'),
    setup: { aircraft: 'voltranger', environment: 'countryside', launch: 'air', air: { alt: 60, dist: 160 }, weather: { windSpeed: 3, gusts: 0.2, turbulence: 0.2, thermals: 0.2, sky: 'partly', timeOfDay: 12 }, throttle: 0.65 },
    steps: [
      { text: S('Mantén 60 m de altura (±8 m) y el rumbo inicial (±15°) durante 20 s acumulados.', 'Hold 60 m altitude (±8 m) and the initial heading (±15°) for 20 accumulated seconds.'), check: (c, st) => {
        st.h0 ??= c.spawn.heading;
        const ok = Math.abs(c.t.agl - 60) < 8 && Math.abs(wrapPi(c.t.heading - st.h0)) < 15 * DEG;
        st.acc = (st.acc || 0) + (ok ? c.dt : 0);
        return { done: st.acc >= 20, progress: st.acc / 20 };
      } },
    ],
  },
  {
    id: 'l4', kind: 'lesson', difficulty: 2,
    title: S('Lección 4 · Virajes', 'Lesson 4 · Turns'),
    desc: S('Virajes coordinados: inclinación con alerones, un poco de profundidad para no perder altura y timón para anular el derrape.', 'Coordinated turns: bank with ailerons, a little up-elevator to hold altitude and rudder to cancel sideslip.'),
    setup: { aircraft: 'skylark', environment: 'airfield', launch: 'air', air: { alt: 60, dist: 150 }, weather: { windSpeed: 2, gusts: 0.1, turbulence: 0.1, thermals: 0, sky: 'clear', timeOfDay: 15 }, throttle: 0.65 },
    steps: [
      { text: S('Viraje completo de 360° a la IZQUIERDA (alabeo 20–45°) sin variar la altura más de 15 m.', 'Full 360° LEFT turn (20–45° bank) holding altitude within 15 m.'), stick: ['aileron', -1], check: (c, st) => {
        st.alt0 ??= c.t.agl;
        if (Math.abs(c.t.agl - st.alt0) > 15) { st.turned = 0; st.lastHdg = null; st.warn = true; }
        const tr = headingChange(st, c.t);
        return { done: tr < -330, progress: clamp(-tr / 360, 0, 1) };
      } },
      { text: S('Ahora 360° a la DERECHA, igual de limpio.', 'Now 360° to the RIGHT, just as clean.'), stick: ['aileron', 1], check: (c, st) => {
        st.alt0 ??= c.t.agl;
        if (Math.abs(c.t.agl - st.alt0) > 15) { st.turned = 0; st.lastHdg = null; }
        const tr = headingChange(st, c.t);
        return { done: tr > 330, progress: clamp(tr / 360, 0, 1) };
      } },
      { text: S('Viraje coordinado: mantén el derrape por debajo de 5° durante 8 s mientras viras.', 'Coordinated turn: keep sideslip under 5° for 8 s while turning.'), stick: ['rudder', 0], check: (c, st) => sustained(st, 'co', Math.abs(c.t.bank) > 15 * DEG && Math.abs(c.t.beta) < 5 * DEG, c.dt, 8) },
    ],
  },
  {
    id: 'l5', kind: 'lesson', difficulty: 2,
    title: S('Lección 5 · La pérdida', 'Lesson 5 · The stall'),
    desc: S('Provoca una pérdida real, observa la caída de sustentación y recupera con seguridad: cede profundidad y da motor.', 'Cause a real stall, observe the loss of lift and recover safely: release elevator and add power.'),
    setup: { aircraft: 'falcon46', environment: 'airfield', launch: 'air', air: { alt: 130, dist: 160 }, weather: { windSpeed: 1, gusts: 0, turbulence: 0, thermals: 0, sky: 'clear', timeOfDay: 11 }, throttle: 0.6, recommendAssist: 'expert' },
    steps: [
      { text: S('Corta el motor (acelerador a cero).', 'Cut the throttle to zero.'), stick: ['throttle', -1], check: (c) => c.input.throttle < 0.05 },
      { text: S('Tira poco a poco de la profundidad y mantén el morro alto hasta que el ala entre en pérdida.', 'Gradually pull and hold the nose high until the wing stalls.'), stick: ['elevator', 1], check: (c, st) => {
        if (c.t.stall > 0.35) { st.altAtStall = c.t.agl; return true; }
        return false;
      } },
      { text: S('¡Pérdida! Cede la profundidad, nivela alas y da motor hasta recuperar velocidad.', 'Stall! Release elevator, level the wings and add power until speed recovers.'), stick: ['elevator', -1], check: (c, st, ls) => {
        const ok = c.t.airspeed > c.ac.spec.perf.stallSpeed * 1.3 && c.t.vs > -1.5 && Math.abs(c.t.bank) < 25 * DEG && c.t.stall < 0.05;
        if (ok) ls.altLost = Math.max(0, (ls.steps?.[1]?.altAtStall ?? c.t.agl) - c.t.agl);
        return ok;
      } },
    ],
  },
  {
    id: 'l6', kind: 'lesson', difficulty: 2,
    title: S('Lección 6 · Aterrizaje', 'Lesson 6 · Landing'),
    desc: S('Aproximación estabilizada, descenso controlado, redondeo (flare) y toma suave en la pista.', 'Stabilised approach, controlled descent, flare and a smooth touchdown on the runway.'),
    setup: { aircraft: 'skylark', environment: 'airfield', launch: 'approach', air: { alt: 35, dist: 230 }, weather: { windSpeed: 2, gusts: 0.1, turbulence: 0.1, thermals: 0, sky: 'clear', timeOfDay: 17 }, throttle: 0.35 },
    steps: [
      { text: S('Alinea el avión con la pista y mantenlo alineado 2 s.', 'Line up with the runway and hold it for 2 s.'), check: (c, st) => sustained(st, 'al', c.runwayAlign != null && c.runwayAlign < 10 && Math.abs(c.lateral ?? 99) < 15, c.dt, 2) },
      { text: S('Reduce motor y desciende de forma estable (entre −0,5 y −3 m/s).', 'Reduce power and descend steadily (−0.5 to −3 m/s).'), stick: ['throttle', -1], check: (c, st) => sustained(st, 'ds', c.input.throttle < 0.45 && c.t.vs < -0.5 && c.t.vs > -3, c.dt, 3) },
      { text: S('A 2–3 m del suelo tira suavemente (flare) y toma tierra.', 'At 2–3 m above ground flare gently and touch down.'), stick: ['elevator', 1], check: (c, st, ls) => { if (c.landing) { ls.landing = c.landing; return true; } return false; } },
      { text: S('Corta motor y frena hasta detenerte.', 'Cut power and brake to a stop.'), check: (c) => c.t.groundSpeed < 1 && c.t.wheelsOnGround > 0 },
    ],
  },
  {
    id: 'l7', kind: 'lesson', difficulty: 3,
    title: S('Lección 7 · Acrobacia', 'Lesson 7 · Aerobatics'),
    desc: S('Looping, tonel, vuelo invertido e Immelmann con un Extra 300. Las maniobras se detectan por el vuelo real.', 'Loop, roll, inverted flight and Immelmann with an Extra 300. Manoeuvres are detected from actual flight.'),
    setup: { aircraft: 'extra300', environment: 'competition', launch: 'air', air: { alt: 120, dist: 180 }, weather: { windSpeed: 1.5, gusts: 0.1, turbulence: 0.05, thermals: 0, sky: 'clear', timeOfDay: 12 }, throttle: 0.75, recommendAssist: 'intermediate' },
    steps: [
      { text: S('LOOPING: con motor alto, tira de la profundidad y mantenla hasta completar el círculo.', 'LOOP: with high power, pull the elevator and hold it until the circle is complete.'), stick: ['elevator', 1], check: (c) => c.maneuvers.some((m) => m.id === 'loop') },
      { text: S('TONEL: alerón a fondo hacia un lado hasta girar 360° y nivela.', 'ROLL: full aileron to one side until you rotate 360°, then level.'), stick: ['aileron', 1], check: (c) => c.maneuvers.some((m) => m.id === 'roll' || m.id === 'doubleRoll') },
      { text: S('INVERTIDO: medio tonel y empuja la profundidad para mantener la altura 3 s.', 'INVERTED: half roll and push the elevator to hold altitude for 3 s.'), stick: ['elevator', -1], check: (c) => c.maneuvers.some((m) => m.id === 'inverted') },
      { text: S('IMMELMANN: medio looping hacia arriba y medio tonel para salir nivelado en sentido contrario.', 'IMMELMANN: half loop up then half roll to exit level in the opposite direction.'), check: (c) => c.maneuvers.some((m) => m.id === 'immelmann') },
    ],
  },
  {
    id: 'l8', kind: 'lesson', difficulty: 3,
    title: S('Lección 8 · Planeadores', 'Lesson 8 · Gliders'),
    desc: S('Vuelo de ladera, aprovechamiento de térmicas y gestión de la energía sin motor.', 'Slope soaring, using thermals and energy management without an engine.'),
    setup: { aircraft: 'ridgeracer', environment: 'mountains', launch: 'hand', weather: { windSpeed: 7, windDir: 270, gusts: 0.2, turbulence: 0.2, thermals: 0.8, sky: 'partly', timeOfDay: 13, thermalHints: true } },
    steps: [
      { text: S('Lanza el planeador hacia el viento (botón Lanzar / Espacio) con el morro ligeramente bajo.', 'Throw the glider into the wind (Launch button / Space) with the nose slightly down.'), check: (c) => !c.ac.held && c.t.airspeed > 6 },
      { text: S('Vuela paralelo a la ladera, por delante de la cresta, y gana 20 m sobre el punto de lanzamiento.', 'Fly parallel to the slope, in front of the ridge, and gain 20 m above the launch point.'), check: (c, st) => { st.y0 ??= c.spawn.y; return c.ac.pos.y > st.y0 + 20; } },
      { text: S('Mantente en la ascendencia de ladera 45 s sin bajar del punto de lanzamiento.', 'Stay in the slope lift for 45 s without dropping below the launch point.'), check: (c, st) => {
        st.y0 ??= c.spawn.y;
        st.acc = (st.acc || 0) + (c.ac.pos.y > st.y0 ? c.dt : 0);
        return { done: st.acc >= 45, progress: st.acc / 45 };
      } },
      { text: S('Busca una TÉRMICA (columnas de vilanos, vario agudo) y gana 25 m girando dentro de ella.', 'Find a THERMAL (rising seed puffs, high-pitched vario) and gain 25 m circling in it.'), check: (c, st) => {
        const th = c.weather.thermalLift(c.ac.pos.x, c.ac.pos.z, c.t.agl, c.ac.pos.y);
        if (th > 0.6) { st.inTh = true; st.gain = (st.gain || 0) + Math.max(0, c.t.vs) * c.dt; }
        return { done: (st.gain || 0) >= 25, progress: clamp((st.gain || 0) / 25, 0, 1) };
      } },
      { text: S('Gestiona la energía: vuelve a la cima y aterriza en el prado.', 'Manage your energy: return to the top and land in the meadow.'), check: (c, st, ls) => { if (c.landing && !c.landing.destroyed) { ls.landing = c.landing; return true; } return false; } },
    ],
  },
];

/* ───────────────────────────── DESAFÍOS ───────────────────────────── */

const MEDALS = ['bronze', 'silver', 'gold'];

export function medalFor(ch, score) {
  const m = ch.medals;
  let medal = null;
  MEDALS.forEach((k) => { if (score >= m[k]) medal = k; });
  return medal;
}

export const CHALLENGES = [
  {
    id: 'c1', kind: 'challenge', difficulty: 1, icon: 'target',
    title: S('Aterrizaje de precisión', 'Precision landing'),
    desc: S('Aterriza lo más cerca posible del centro de la diana con un toque suave.', 'Land as close as possible to the centre of the target with a soft touchdown.'),
    setup: { aircraft: 'cessna182', environment: 'airfield', launch: 'approach', air: { alt: 40, dist: 260 }, weather: { windSpeed: 2.5, gusts: 0.2, turbulence: 0.15, thermals: 0, sky: 'partly', timeOfDay: 16 }, throttle: 0.35 },
    timeLimit: 120, medals: { bronze: 50, silver: 72, gold: 88 }, unit: 'pts',
    markers: (env) => [{ type: 'pad', x: env.landingTarget.x, y: env.heightAt(env.landingTarget.x, env.landingTarget.z), z: env.landingTarget.z, radius: 6, color: '#ffeb3b' }],
    update: (c, st) => c.landing ? { done: true, score: c.landing.score, detail: c.landing } : null,
  },
  {
    id: 'c2', kind: 'challenge', difficulty: 3, icon: 'wind',
    title: S('Aterrizaje con viento cruzado', 'Crosswind landing'),
    desc: S('Viento de 6 m/s perpendicular a la pista con ráfagas. Corrige la deriva y toma alineado.', '6 m/s wind across the runway with gusts. Correct the drift and touch down aligned.'),
    setup: { aircraft: 'falcon46', environment: 'airfield', launch: 'approach', air: { alt: 40, dist: 260 }, weather: { windSpeed: 6, windDir: 180, gusts: 0.5, turbulence: 0.35, thermals: 0, sky: 'cloudy', timeOfDay: 14 }, throttle: 0.4 },
    timeLimit: 150, medals: { bronze: 45, silver: 68, gold: 85 }, unit: 'pts',
    update: (c) => c.landing ? { done: true, score: c.landing.onRunway ? c.landing.score : Math.round(c.landing.score * 0.5), detail: c.landing } : null,
  },
  {
    id: 'c3', kind: 'challenge', difficulty: 2, icon: 'rings',
    title: S('Vuelo entre puntos de referencia', 'Waypoint run'),
    desc: S('Atraviesa los 6 aros en orden lo más rápido posible.', 'Fly through the 6 rings in order as fast as possible.'),
    setup: { aircraft: 'voltranger', environment: 'countryside', launch: 'air', air: { alt: 40, dist: 60 }, weather: { windSpeed: 2, gusts: 0.2, turbulence: 0.15, thermals: 0.2, sky: 'partly', timeOfDay: 11 }, throttle: 0.7 },
    timeLimit: 240, medals: { bronze: 30, silver: 60, gold: 80 }, unit: 'pts',
    rings: [[120, 40, -180], [320, 50, -60], [360, 35, 200], [100, 60, 330], [-180, 45, 220], [-200, 40, -40]],
    ringRadius: 12,
    markers: (env, ch) => ringMarkers(env, ch),
    update: (c, st, ch) => ringUpdate(c, st, ch, (time) => Math.round(clamp(100 - (time - 50) * 0.6, 0, 100))),
  },
  {
    id: 'c4', kind: 'challenge', difficulty: 4, icon: 'pylon',
    title: S('Circuito de obstáculos', 'Obstacle course'),
    desc: S('Aros pequeños y bajos alrededor del aeródromo de competición. Cada aro fallado penaliza.', 'Small, low rings around the competition field. Each missed ring costs points.'),
    setup: { aircraft: 'edge540', environment: 'competition', launch: 'air', air: { alt: 25, dist: 120 }, weather: { windSpeed: 2, gusts: 0.2, turbulence: 0.1, thermals: 0, sky: 'clear', timeOfDay: 12 }, throttle: 0.7 },
    timeLimit: 180, medals: { bronze: 30, silver: 60, gold: 82 }, unit: 'pts',
    rings: [[-150, 12, -120], [0, 8, -200], [150, 14, -120], [200, 10, 0], [80, 18, 80], [-120, 9, 60], [-220, 15, -40]],
    ringRadius: 6,
    markers: (env, ch) => ringMarkers(env, ch),
    update: (c, st, ch) => ringUpdate(c, st, ch, (time) => Math.round(clamp(100 - (time - 35) * 0.9, 0, 100))),
  },
  {
    id: 'c5', kind: 'challenge', difficulty: 2, icon: 'battery',
    title: S('Vuelo de duración', 'Endurance flight'),
    desc: S('Motovelero con la batería al 30%. Mantente en el aire el máximo tiempo y aterriza sin daños.', 'Motor-glider with 30% battery. Stay aloft as long as possible and land undamaged.'),
    setup: { aircraft: 'zephyr', environment: 'countryside', launch: 'hand', battery: 0.3, weather: { windSpeed: 2, gusts: 0.2, turbulence: 0.15, thermals: 0.7, sky: 'partly', timeOfDay: 13, thermalHints: true } },
    timeLimit: 900, medals: { bronze: 180, silver: 360, gold: 540 }, unit: 's',
    update: (c, st) => {
      if (!c.ac.held && c.t.agl > 3) st.flying = true;
      if (st.flying) st.air = (st.air || 0) + c.dt;
      if (c.landing && st.air > 10) return { done: true, score: Math.round(c.landing.destroyed ? st.air * 0.5 : st.air), detail: c.landing };
      return { progressText: `${Math.round(st.air || 0)} s` };
    },
  },
  {
    id: 'c6', kind: 'challenge', difficulty: 4, icon: 'loop',
    title: S('Programa acrobático', 'Aerobatic schedule'),
    desc: S('Realiza: looping, tonel, Immelmann, vuelo invertido y knife-edge. Puntúa la ejecución.', 'Fly: loop, roll, Immelmann, inverted flight and knife-edge. Execution is scored.'),
    setup: { aircraft: 'extra300', environment: 'competition', launch: 'air', air: { alt: 110, dist: 160 }, weather: { windSpeed: 1.5, gusts: 0.1, turbulence: 0.05, thermals: 0, sky: 'clear', timeOfDay: 12 }, throttle: 0.75 },
    timeLimit: 300, medals: { bronze: 25, silver: 35, gold: 43 }, unit: 'pts',
    sequence: ['loop', 'roll', 'immelmann', 'inverted', 'knifeEdge'],
    update: (c, st, ch) => {
      st.got ??= {};
      for (const m of c.maneuvers) {
        const id = m.id === 'doubleRoll' ? 'roll' : m.id;
        if (ch.sequence.includes(id) && !(id in st.got)) st.got[id] = m.score ?? 6;
      }
      const n = Object.keys(st.got).length;
      const score = Math.round(Object.values(st.got).reduce((a, b) => a + b, 0));
      if (n === ch.sequence.length) return { done: true, score };
      return { progressText: `${n}/${ch.sequence.length}`, score };
    },
  },
  {
    id: 'c7', kind: 'challenge', difficulty: 3, icon: 'thermal',
    title: S('Competición de planeadores', 'Glider contest'),
    desc: S('Lanzamiento con goma (bungee). Gana altura en térmicas: puntúa la altura máxima y el tiempo de vuelo, con bonificación por aterrizar en la diana.', 'Bungee launch. Climb in thermals: max height and flight time score, with a bonus for landing on the target.'),
    setup: { aircraft: 'nimbusf3j', environment: 'countryside', launch: 'bungee', weather: { windSpeed: 2.5, gusts: 0.2, turbulence: 0.15, thermals: 1, sky: 'partly', timeOfDay: 13, thermalHints: true } },
    timeLimit: 600, medals: { bronze: 250, silver: 450, gold: 650 }, unit: 'pts',
    markers: (env) => [{ type: 'pad', x: env.landingTarget.x, y: env.heightAt(env.landingTarget.x, env.landingTarget.z), z: env.landingTarget.z, radius: 8, color: '#ffeb3b' }],
    update: (c, st) => {
      if (c.t.agl > 5) { st.flying = true; st.maxAlt = Math.max(st.maxAlt || 0, c.t.agl); }
      if (st.flying) st.air = (st.air || 0) + c.dt;
      const base = Math.round((st.air || 0) * 0.6 + (st.maxAlt || 0) * 1.5);
      if (c.landing && st.flying && st.air > 10) {
        const bonus = c.landing.targetDist != null ? Math.round(clamp(100 - c.landing.targetDist * 2, 0, 100)) : 0;
        return { done: true, score: c.landing.destroyed ? Math.round(base * 0.5) : base + bonus, detail: c.landing };
      }
      return { progressText: `${Math.round(st.maxAlt || 0)} m · ${Math.round(st.air || 0)} s`, score: base };
    },
  },
  {
    id: 'c8', kind: 'challenge', difficulty: 4, icon: 'mountain',
    title: S('Vuelo de ladera (velocidad)', 'Slope speed race'),
    desc: S('Prueba tipo F3F: 6 tramos entre las dos balizas de la cresta lo más rápido posible.', 'F3F-style task: 6 legs between the two ridge pylons as fast as possible.'),
    setup: { aircraft: 'ridgeracer', environment: 'mountains', launch: 'hand', weather: { windSpeed: 8, windDir: 270, gusts: 0.25, turbulence: 0.2, thermals: 0.2, sky: 'clear', timeOfDay: 14 } },
    timeLimit: 300, medals: { bronze: 30, silver: 60, gold: 80 }, unit: 'pts',
    markers: (env) => {
      const out = [];
      for (const z of [-100, 100]) {
        const x = env.crestX(z) - 30;
        out.push({ type: 'pylon', x, y: env.heightAt(x, z), z, h: 10, color: '#ff6d00' });
      }
      return out;
    },
    update: (c, st) => {
      const z = c.ac.pos.z;
      st.legs ??= 0;
      if (st.side == null) st.side = z < -100 ? -1 : z > 100 ? 1 : 0;
      if (!st.started && Math.abs(z) < 100 && st.side !== 0) { st.started = true; st.t0 = c.time; st.next = -st.side; }
      if (st.started) {
        if ((st.next > 0 && z > 100) || (st.next < 0 && z < -100)) { st.legs++; st.next = -st.next; }
        if (st.legs >= 6) {
          const time = c.time - st.t0;
          return { done: true, score: Math.round(clamp(100 - (time - 40) * 1.2, 0, 100)), detail: { time } };
        }
      } else if (Math.abs(z) > 100) st.side = Math.sign(z);
      return { progressText: `${st.legs}/6` };
    },
  },
  {
    id: 'c9', kind: 'challenge', difficulty: 3, icon: 'rough',
    title: S('Aterrizaje en terreno irregular', 'Rough-field landing'),
    desc: S('Aterriza el Tundra Cub en el prado señalado (fuera de pista) y detente dentro de la zona.', 'Land the Tundra Cub in the marked meadow (off-field) and stop inside the zone.'),
    setup: { aircraft: 'tundracub', environment: 'countryside', launch: 'air', air: { alt: 45, dist: 260, toward: { x: 260, z: 120 } }, weather: { windSpeed: 3, gusts: 0.3, turbulence: 0.25, thermals: 0.3, sky: 'partly', timeOfDay: 9 }, throttle: 0.4 },
    timeLimit: 180, medals: { bronze: 45, silver: 68, gold: 85 }, unit: 'pts',
    zone: { x: 260, z: 120, r: 30 },
    markers: (env, ch) => [{ type: 'pad', x: ch.zone.x, y: env.heightAt(ch.zone.x, ch.zone.z), z: ch.zone.z, radius: ch.zone.r, color: '#ff7043' }],
    update: (c, st, ch) => {
      if (c.landing) st.landing = c.landing;
      if (st.landing && c.t.groundSpeed < 0.6) {
        const d = Math.hypot(c.ac.pos.x - ch.zone.x, c.ac.pos.z - ch.zone.z);
        const inside = d < ch.zone.r;
        return { done: true, score: Math.round(inside ? st.landing.score * 0.6 + 40 * clamp(1 - d / ch.zone.r, 0, 1) : st.landing.score * 0.3), detail: { ...st.landing, inside, dist: d } };
      }
      return null;
    },
  },
  {
    id: 'c10', kind: 'challenge', difficulty: 5, icon: 'storm',
    title: S('Control con viento fuerte', 'Strong-wind control'),
    desc: S('Viento de 11 m/s con ráfagas y turbulencia. Mantente dentro de la caja 90 s (5–40 m de altura).', '11 m/s wind with gusts and turbulence. Stay inside the box for 90 s (5–40 m height).'),
    setup: { aircraft: 'titan2100', environment: 'airfield', launch: 'air', air: { alt: 25, dist: 60 }, weather: { windSpeed: 11, windDir: 250, gusts: 0.8, turbulence: 0.7, thermals: 0, sky: 'cloudy', timeOfDay: 15 }, throttle: 0.6 },
    timeLimit: 150, medals: { bronze: 40, silver: 65, gold: 85 }, unit: 'pts',
    box: { x: 0, z: -60, w: 260, d: 180 },
    markers: (env, ch) => [{ type: 'box', x: ch.box.x, y: env.heightAt(ch.box.x, ch.box.z) + 5, z: ch.box.z, w: ch.box.w, h: 35, d: ch.box.d, color: '#4fc3f7' }],
    update: (c, st, ch) => {
      const b = ch.box;
      const inside = Math.abs(c.ac.pos.x - b.x) < b.w / 2 && Math.abs(c.ac.pos.z - b.z) < b.d / 2 && c.t.agl > 5 && c.t.agl < 40;
      st.in = (st.in || 0) + (inside ? c.dt : 0);
      st.el = (st.el || 0) + c.dt;
      if (st.el >= 90) return { done: true, score: Math.round((st.in / 90) * 100) };
      return { progressText: `${Math.round(st.in)} / ${Math.round(st.el)} s`, warn: !inside };
    },
  },
];

function ringMarkers(env, ch) {
  return ch.rings.map(([x, alt, z], i) => {
    const [nx, , nz] = ch.rings[(i + 1) % ch.rings.length];
    const [px, , pz] = ch.rings[(i + ch.rings.length - 1) % ch.rings.length];
    // el aro mira en la dirección del recorrido (de anterior a siguiente)
    const yaw = Math.atan2(nx - px, nz - pz);
    return { type: 'ring', x, y: env.heightAt(x, z) + alt, z, radius: ch.ringRadius, yaw };
  });
}

function ringUpdate(c, st, ch, scoreFn) {
  st.idx ??= 0;
  st.missed ??= 0;
  const [x, alt, z] = ch.rings[st.idx];
  const y = c.env.heightAt(x, z) + alt;
  const d = Math.hypot(c.ac.pos.x - x, c.ac.pos.y - y, c.ac.pos.z - z);
  st.highlight = st.idx;
  if (d < ch.ringRadius) { st.idx++; st.passed = (st.passed || 0) + 1; c.sound?.('ring'); }
  if (st.idx >= ch.rings.length) {
    const score = clamp(scoreFn(c.time) - st.missed * 15, 0, 100);
    return { done: true, score, detail: { time: c.time } };
  }
  return { progressText: `${st.idx}/${ch.rings.length}`, highlight: st.idx, target: { x, y, z } };
}

/* ───────────────────────────── ejecutor ───────────────────────────── */

export class MissionRunner {
  constructor(mission) {
    this.m = mission;
    this.state = { steps: [] };
    this.step = 0;
    this.stepState = {};
    this.time = 0;
    this.finished = false;
    this.failed = false;
    this.result = null;
    this.resets = 0;
    this.progress = 0;
    this.stepTimes = [];
  }

  get isLesson() { return this.m.kind === 'lesson'; }

  get currentStep() { return this.isLesson ? this.m.steps[this.step] : null; }

  onReset() { this.resets++; this.stepState = {}; }

  update(ctx) {
    if (this.finished) return null;
    this.time += ctx.dt;
    ctx.time = this.time;
    if (this.isLesson) {
      const step = this.m.steps[this.step];
      const r = step.check(ctx, this.stepState, this.state);
      const done = typeof r === 'object' && r !== null ? r.done : !!r;
      this.progress = typeof r === 'object' && r !== null ? r.progress ?? 0 : 0;
      if (done) {
        this.state.steps[this.step] = this.stepState;
        this.stepTimes.push(this.time);
        this.step++;
        this.stepState = {};
        if (this.step >= this.m.steps.length) {
          this.finished = true;
          const expected = this.m.steps.length * 25;
          const score = Math.round(clamp(100 - Math.max(0, this.time - expected) * 0.25 - this.resets * 12, 30, 100));
          this.result = { score, stars: score >= 85 ? 3 : score >= 65 ? 2 : 1, time: this.time, extra: this.state };
          return { type: 'complete', result: this.result };
        }
        return { type: 'step', index: this.step };
      }
      return null;
    }
    // desafío
    const ch = this.m;
    if (ch.timeLimit && this.time > ch.timeLimit) {
      const sc = this.stepState.lastScore ?? 0;
      this.finished = true;
      this.result = { score: sc, medal: medalFor(ch, sc), timeout: true, time: this.time };
      return { type: 'complete', result: this.result };
    }
    const r = ch.update(ctx, this.stepState, ch);
    if (r && r.score != null) this.stepState.lastScore = r.score;
    this.lastStatus = r;
    if (r && r.done) {
      this.finished = true;
      this.result = { score: r.score, medal: medalFor(ch, r.score), detail: r.detail, time: this.time };
      return { type: 'complete', result: this.result };
    }
    return null;
  }

  /** Fallo por destrucción de la aeronave. */
  fail(reason) {
    if (this.finished) return;
    if (this.isLesson) { this.onReset(); return; }
    this.finished = true;
    this.failed = true;
    this.result = { score: 0, medal: null, failed: true, reason, time: this.time };
  }
}
