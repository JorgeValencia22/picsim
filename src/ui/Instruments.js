/**
 * Instrumentos analógicos dibujados en Canvas 2D: anemómetro, altímetro, variómetro,
 * horizonte artificial, brújula, tacómetro y batería/combustible. Sólo se muestran los que
 * corresponden al tipo de aeronave (por ejemplo, sin tacómetro en un planeador).
 */
import { L } from '../core/i18n.js';
import { clamp, RAD } from '../utils/math3d.js';

const S = 208; // tamaño interno del lienzo (se muestra a la mitad → nítido en pantallas HiDPI)

function bezel(g, label) {
  g.clearRect(0, 0, S, S);
  g.save();
  g.translate(S / 2, S / 2);
  g.fillStyle = '#0d1218';
  g.beginPath(); g.arc(0, 0, 100, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#38424e'; g.lineWidth = 6;
  g.beginPath(); g.arc(0, 0, 100, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#93a4b5'; g.font = '600 15px Inter, sans-serif'; g.textAlign = 'center';
  g.fillText(label, 0, 46);
}

function dial(g, min, max, a0, a1, majors, minors, fmt, arcs = []) {
  const ang = (v) => a0 + ((v - min) / (max - min)) * (a1 - a0);
  for (const [from, to, col] of arcs) {
    g.strokeStyle = col; g.lineWidth = 7;
    g.beginPath(); g.arc(0, 0, 84, ang(from) - Math.PI / 2, ang(to) - Math.PI / 2); g.stroke();
  }
  g.strokeStyle = '#e9eef4';
  for (let v = min; v <= max + 1e-6; v += minors) {
    const a = ang(v) - Math.PI / 2;
    const major = Math.abs((v - min) / majors - Math.round((v - min) / majors)) < 1e-6;
    g.lineWidth = major ? 3 : 1.5;
    const r0 = major ? 72 : 79;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * 90, Math.sin(a) * 90); g.stroke();
    if (major) {
      g.fillStyle = '#e9eef4'; g.font = '700 16px JetBrains Mono, monospace';
      g.fillText(fmt(v), Math.cos(a) * 57, Math.sin(a) * 57 + 6);
    }
  }
  return ang;
}

function needle(g, a, len = 80, color = '#ff8a1f') {
  g.save();
  g.rotate(a);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(-4, 10); g.lineTo(0, -len); g.lineTo(4, 10); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#2a323c'; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
}

export class Instruments {
  constructor(container) {
    this.container = container;
    this.items = [];
  }

  /** Selecciona los instrumentos según la aeronave. */
  setAircraft(spec) {
    this.container.replaceChildren();
    this.items = [];
    const p = spec.prop.type;
    const list = ['horizon', 'asi', 'alt', 'vario', 'compass'];
    if (p !== 'none') list.push('tacho');
    if (p === 'electric' || p === 'edf') list.push('battery');
    else if (p !== 'none') list.push('fuel');
    this.maxSpeed = Math.max(20, spec.perf.maxSpeed * 1.25);
    this.stall = spec.perf.stallSpeed;
    this.glider = spec.category === 'glider';
    for (const kind of list) {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      c.setAttribute('aria-label', kind);
      this.container.append(c);
      this.items.push({ kind, g: c.getContext('2d') });
    }
  }

  draw(t, extra) {
    for (const it of this.items) this[it.kind](it.g, t, extra);
  }

  asi(g, t) {
    const kmh = (v) => v * 3.6;
    const max = Math.ceil(kmh(this.maxSpeed) / 20) * 20;
    bezel(g, 'km/h');
    const ang = dial(g, 0, max, -2.4, 2.4, max > 200 ? 40 : 20, max > 200 ? 10 : 5, (v) => String(v),
      [[kmh(this.stall), kmh(this.stall * 1.6), '#45d483'], [kmh(this.stall * 0.6), kmh(this.stall), '#ffc93d'], [kmh(this.maxSpeed * 0.85), max, '#ff5a5f']]);
    needle(g, ang(clamp(kmh(t.airspeed), 0, max)));
    g.restore();
  }

  alt(g, t) {
    bezel(g, L('m (suelo)', 'm (AGL)'));
    const ang = dial(g, 0, 100, 0, Math.PI * 2 * 0.999, 10, 2, (v) => (v === 100 ? '' : String(v / 10)));
    const agl = Math.max(0, t.agl);
    needle(g, ang((agl / 10) % 10 * 10), 50, '#e9eef4');
    needle(g, ang(agl % 100), 82);
    g.fillStyle = '#e9eef4'; g.font = '700 18px JetBrains Mono, monospace'; g.textAlign = 'center';
    g.fillText(String(Math.round(agl)), 0, -28);
    g.restore();
  }

  vario(g, t) {
    bezel(g, 'm/s');
    const ang = dial(g, -5, 5, -2.6, 2.6, 1, 0.5, (v) => (v > 0 ? `+${v}` : String(v)), [[0, 5, 'rgba(69,212,131,.6)'], [-5, 0, 'rgba(255,90,95,.45)']]);
    needle(g, ang(clamp(t.vs, -5, 5)), 82, t.vs > 0.2 ? '#45d483' : '#ff8a1f');
    g.restore();
  }

  horizon(g, t) {
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2);
    g.beginPath(); g.arc(0, 0, 97, 0, Math.PI * 2); g.clip();
    g.rotate(-t.bank);
    const off = clamp(t.pitch * RAD, -60, 60) * 2.2;
    g.fillStyle = '#2f7fd0'; g.fillRect(-200, -400 + off, 400, 400);
    g.fillStyle = '#7a5530'; g.fillRect(-200, off, 400, 400);
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-200, off); g.lineTo(200, off); g.stroke();
    g.lineWidth = 1.5; g.fillStyle = '#fff'; g.font = '11px JetBrains Mono, monospace'; g.textAlign = 'center';
    for (let p = -40; p <= 40; p += 10) {
      if (!p) continue;
      const y = off - p * 2.2;
      const w = p % 20 ? 14 : 26;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      if (!(p % 20)) g.fillText(String(Math.abs(p)), w + 14, y + 4);
    }
    g.restore();
    g.save();
    g.translate(S / 2, S / 2);
    g.strokeStyle = '#ff8a1f'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(-60, 0); g.lineTo(-20, 0); g.lineTo(-10, 10); g.moveTo(60, 0); g.lineTo(20, 0); g.lineTo(10, 10); g.stroke();
    g.fillStyle = '#ff8a1f'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#38424e'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 100, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  compass(g, t) {
    bezel(g, '');
    g.save();
    g.rotate(-t.heading);
    const labels = { 0: 'N', 90: 'E', 180: 'S', 270: L('O', 'W') };
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180 - Math.PI / 2;
      const major = d % 30 === 0;
      g.strokeStyle = '#e9eef4'; g.lineWidth = major ? 3 : 1.5;
      g.beginPath(); g.moveTo(Math.cos(a) * (major ? 74 : 81), Math.sin(a) * (major ? 74 : 81)); g.lineTo(Math.cos(a) * 90, Math.sin(a) * 90); g.stroke();
      if (major) {
        g.save(); g.rotate(a + Math.PI / 2);
        g.fillStyle = labels[d] ? (d === 0 ? '#ff8a1f' : '#e9eef4') : '#93a4b5';
        g.font = labels[d] ? '700 20px Rajdhani, sans-serif' : '600 13px JetBrains Mono, monospace';
        g.fillText(labels[d] || String(d / 10), 0, -54);
        g.restore();
      }
    }
    g.restore();
    g.fillStyle = '#ff8a1f';
    g.beginPath(); g.moveTo(0, -38); g.lineTo(-8, 4); g.lineTo(8, 4); g.closePath(); g.fill();
    g.fillStyle = '#e9eef4'; g.font = '700 17px JetBrains Mono, monospace';
    g.fillText(`${String(Math.round((t.heading * RAD) % 360)).padStart(3, '0')}°`, 0, 32);
    g.restore();
  }

  tacho(g, t, x) {
    bezel(g, x.turbine ? 'N1 %' : 'RPM ×1000');
    if (x.turbine) {
      const ang = dial(g, 0, 110, -2.4, 2.4, 20, 5, String, [[100, 110, '#ff5a5f']]);
      needle(g, ang(x.rpmFrac * 100));
    } else {
      const max = Math.ceil(x.rpmMax / 1000 / 2) * 2;
      const ang = dial(g, 0, max, -2.4, 2.4, max > 14 ? 4 : 2, 1, String);
      needle(g, ang(clamp(t.rpm / 1000, 0, max)));
    }
    g.restore();
  }

  battery(g, t, x) {
    bezel(g, L('Batería', 'Battery'));
    const ang = dial(g, 0, 100, -2.2, 2.2, 25, 5, String, [[0, 20, '#ff5a5f'], [20, 40, '#ffc93d']]);
    needle(g, ang(x.remaining * 100), 80, x.remaining < 0.2 ? '#ff5a5f' : '#45d483');
    g.fillStyle = '#e9eef4'; g.font = '700 15px JetBrains Mono, monospace';
    g.fillText(`${x.voltage.toFixed(1)} V`, 0, -26);
    g.restore();
  }

  fuel(g, t, x) {
    bezel(g, L('Combustible', 'Fuel'));
    const ang = dial(g, 0, 100, -2.2, 2.2, 25, 5, (v) => (v === 0 ? 'E' : v === 100 ? 'F' : ''), [[0, 15, '#ff5a5f']]);
    needle(g, ang(x.remaining * 100), 80, x.remaining < 0.15 ? '#ff5a5f' : '#ff8a1f');
    g.restore();
  }
}
