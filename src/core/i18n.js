/**
 * Internacionalización mínima (español / inglés). Los textos se escriben en el propio código
 * como pares L('es', 'en') o como objetos { es, en } en los datos; el idioma activo se lee aquí.
 */
let lang = 'es';
const listeners = new Set();

export function setLanguage(l) {
  lang = l === 'en' ? 'en' : 'es';
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export function getLanguage() { return lang; }

export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Texto en línea: L('Volar', 'Fly'). */
export function L(es, en) { return lang === 'en' ? (en ?? es) : es; }

/** Texto desde un objeto de datos { es, en } (o una cadena). */
export function T(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj.es ?? '';
}

/* ───────────────────────── Unidades ───────────────────────── */
let units = 'metric';
export function setUnits(u) { units = u; }
export function getUnits() { return units; }

export function fmtSpeed(ms, withUnit = true) {
  if (units === 'imperial') return `${Math.round(ms * 2.23694)}${withUnit ? ' mph' : ''}`;
  return `${Math.round(ms * 3.6)}${withUnit ? ' km/h' : ''}`;
}
export function fmtAlt(m, withUnit = true) {
  if (units === 'imperial') return `${Math.round(m * 3.28084)}${withUnit ? ' ft' : ''}`;
  return `${Math.round(m)}${withUnit ? ' m' : ''}`;
}
export function fmtVs(ms) {
  if (units === 'imperial') return `${(ms * 196.85).toFixed(0)} ft/min`;
  return `${ms >= 0 ? '+' : ''}${ms.toFixed(1)} m/s`;
}
export function fmtDist(m) {
  if (units === 'imperial') return m > 1609 ? `${(m / 1609.34).toFixed(2)} mi` : `${Math.round(m * 3.28084)} ft`;
  return m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
export function fmtMass(kg) {
  if (units === 'imperial') return `${(kg * 2.20462).toFixed(1)} lb`;
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(2)} kg`;
}
export function fmtLen(m) {
  if (units === 'imperial') return `${(m * 39.3701).toFixed(1)} in`;
  return `${m.toFixed(2)} m`;
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
