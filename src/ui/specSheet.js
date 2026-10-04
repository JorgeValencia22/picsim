/** Ficha técnica de una aeronave a partir del spec completo (valores del modelo físico). */
import { h, dots } from './dom.js';
import { L, T, fmtSpeed, fmtMass, fmtLen } from '../core/i18n.js';
import { CATEGORIES, PROPULSION_LABELS, GEAR_LABELS, AIRFOILS } from '../data/aircraftData.js';

export function specRows(s) {
  const p = s.perf;
  const pr = s.prop;
  const rows = [
    [L('Categoría', 'Category'), T(CATEGORIES[s.category])],
    [L('Masa', 'Mass'), fmtMass(s.mass)],
    [L('Envergadura', 'Wingspan'), fmtLen(s.span)],
    [L('Longitud', 'Length'), fmtLen(s.length)],
    [L('Superficie alar', 'Wing area'), `${(s.wingArea * 100).toFixed(1)} dm²`],
    [L('Carga alar', 'Wing loading'), `${(p.wingLoading * 10).toFixed(0)} g/dm²`],
    [L('Perfil', 'Airfoil'), AIRFOILS[s.airfoilKey]?.name || s.airfoilKey],
    [L('Propulsión', 'Propulsion'), T(PROPULSION_LABELS[pr.type])],
  ];
  if (pr.type !== 'none') {
    if (pr.power) rows.push([L('Potencia aprox.', 'Approx. power'), `${Math.round(pr.power)} W`]);
    rows.push([L('Empuje estático', 'Static thrust'), `${pr.thrust.toFixed(0)} N`]);
    rows.push([L('Relación empuje/peso', 'Thrust/weight'), p.thrustWeight.toFixed(2)]);
  }
  rows.push([L('Velocidad de pérdida', 'Stall speed'), s.hasFlaps ? `${fmtSpeed(p.stallSpeed)} (${fmtSpeed(p.stallSpeedFlaps, false)} ${L('con flaps', 'flaps')})` : fmtSpeed(p.stallSpeed)]);
  rows.push([L('Velocidad de crucero', 'Cruise speed'), fmtSpeed(p.cruiseSpeed)]);
  rows.push([L('Velocidad máxima', 'Max speed'), pr.type === 'none' ? `${fmtSpeed(p.maxSpeed)} (${L('picado', 'dive')})` : fmtSpeed(p.maxSpeed)]);
  if (s.category === 'glider' || pr.type === 'none') {
    rows.push([L('Planeo máximo (L/D)', 'Best glide (L/D)'), `${p.bestLD.toFixed(1)} : 1`]);
    rows.push([L('Tasa mínima de caída', 'Min sink rate'), `${p.minSink.toFixed(2)} m/s`]);
  } else rows.push([L('Ascenso máximo', 'Max climb'), `${p.maxClimb.toFixed(1)} m/s`]);
  rows.push([L('Capacidad acrobática', 'Aerobatic capability'), dots(s.aerobatic)]);
  rows.push([L('Dificultad', 'Difficulty'), dots(s.difficulty)]);
  rows.push([L('Autonomía estimada', 'Est. endurance'), p.endurance != null ? `${Math.round(p.endurance)} min` : L('Ilimitada (vuelo sin motor)', 'Unlimited (unpowered)')]);
  if (pr.capacity && pr.type !== 'none') rows.push([pr.type === 'electric' || pr.type === 'edf' ? L('Batería', 'Battery') : L('Depósito', 'Tank'), pr.type === 'electric' || pr.type === 'edf' ? `${pr.cells || '?'}S · ${pr.capacity.toFixed(0)} Wh` : `${pr.capacity} ml`]);
  rows.push([L('Tren de aterrizaje', 'Landing gear'), `${T(GEAR_LABELS[s.gearType])}${s.retract ? L(' retráctil', ' retractable') : ''}`]);
  rows.push([L('Canales', 'Channels'), String(s.channels)]);
  rows.push([L('Margen estático', 'Static margin'), `${(s.staticMargin * 100).toFixed(0)} % CMA`]);
  return rows;
}

export function specTable(spec) {
  return h('div', {},
    h('table', { class: 'spec-table' }, h('tbody', {}, specRows(spec).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))))),
    h('div', { class: 'note' }, L('Valores aproximados calculados con el mismo modelo aerodinámico de la simulación (vuelo nivelado, aire estándar, sin trimado de profundidad). La autonomía se estima al 70 % de acelerador.', 'Approximate values computed with the same aerodynamic model used in flight (level flight, standard air, untrimmed elevator). Endurance estimated at 70% throttle.')));
}

export function quickSpecs(spec) {
  const p = spec.perf;
  const q = (v, l) => h('div', { class: 'qs' }, h('b', {}, v), h('span', {}, l));
  return h('div', { class: 'quick-specs' },
    q(fmtLen(spec.span), L('Envergadura', 'Span')),
    q(fmtMass(spec.mass), L('Masa', 'Mass')),
    q(fmtSpeed(p.stallSpeed), L('Pérdida', 'Stall')),
    q(spec.prop.type === 'none' ? `${p.bestLD.toFixed(0)}:1` : fmtSpeed(p.maxSpeed), spec.prop.type === 'none' ? 'L/D' : L('Máxima', 'Max')));
}
