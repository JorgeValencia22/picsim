/**
 * Persistencia local. Configuración, progreso, récords y estadísticas en localStorage
 * (con espacio de nombres y tolerancia a errores); repeticiones en IndexedDB.
 */
const PREFIX = 'rcfs.';

export class Storage {
  constructor() {
    this.memory = new Map(); // respaldo si localStorage no está disponible (modo privado, etc.)
    try {
      const k = `${PREFIX}__test`;
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  get(key, fallback = null) {
    try {
      const raw = this.available ? localStorage.getItem(PREFIX + key) : this.memory.get(key);
      if (raw == null) return structuredClone(fallback);
      return JSON.parse(raw);
    } catch {
      return structuredClone(fallback);
    }
  }

  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (this.available) localStorage.setItem(PREFIX + key, raw);
      else this.memory.set(key, raw);
      return true;
    } catch (e) {
      console.warn('No se pudo guardar', key, e);
      return false;
    }
  }

  remove(key) {
    try {
      if (this.available) localStorage.removeItem(PREFIX + key);
      else this.memory.delete(key);
    } catch { /* sin acción */ }
  }
}

/** Almacén de repeticiones en IndexedDB (los datos de vuelo pueden ocupar varios MB). */
export class ReplayStore {
  constructor() {
    this.dbPromise = null;
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let req;
      try { req = indexedDB.open('rcfs-replays', 1); } catch { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('replays')) db.createObjectStore('replays', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }

  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const t = db.transaction('replays', mode);
      const store = t.objectStore('replays');
      const r = fn(store);
      t.oncomplete = () => resolve(r?.result ?? true);
      t.onerror = () => resolve(null);
    });
  }

  async save(replay, keep = 8) {
    await this.tx('readwrite', (s) => s.put(replay));
    const all = await this.list();
    if (all.length > keep) {
      const old = all.slice(keep);
      await this.tx('readwrite', (s) => { for (const o of old) s.delete(o.id); });
    }
  }

  async list() {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve) => {
      const out = [];
      const t = db.transaction('replays', 'readonly');
      const req = t.objectStore('replays').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          const { id, meta } = c.value;
          out.push({ id, meta });
          c.continue();
        } else resolve(out.sort((a, b) => b.meta.date - a.meta.date));
      };
      req.onerror = () => resolve([]);
    });
  }

  async get(id) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const req = db.transaction('replays', 'readonly').objectStore('replays').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async remove(id) { await this.tx('readwrite', (s) => s.delete(id)); }

  async clear() { await this.tx('readwrite', (s) => s.clear()); }
}
