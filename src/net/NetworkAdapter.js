/**
 * Preparación para un futuro modo multijugador (NO implementado en esta versión: no existe
 * servidor). Define el contrato que usaría la simulación y un adaptador local sin red.
 *
 * Diseño previsto:
 *  - Identificación del piloto: PilotIdentity { id, name, color }.
 *  - Estado sincronizado: snapshots compactos de AircraftPhysics.snapshot() a 10–20 Hz
 *    con interpolación en el receptor (el mismo esquema que usa ReplayPlayer).
 *  - Salas: { roomId, environmentId, weather, maxPilots } — todos comparten escenario y clima.
 *  - Chat opcional y competiciones (los desafíos ya son deterministas y puntuables).
 *  - Transporte recomendado: WebSocket (o WebRTC DataChannel para baja latencia).
 */

export class NetworkAdapter {
  /** @returns {Promise<boolean>} conexión establecida */
  async connect() { throw new Error('No implementado'); }
  async joinRoom() { throw new Error('No implementado'); }
  /** Envía el estado de la aeronave local. */
  sendState() {}
  /** Recibe estados remotos: [{ pilot, snapshot, t }] */
  pollStates() { return []; }
  sendChat() {}
  disconnect() {}
  get online() { return false; }
}

/** Adaptador por defecto: vuelo individual, sin red. */
export class OfflineAdapter extends NetworkAdapter {
  async connect() { return false; }
  async joinRoom() { return false; }
}

/** Serialización compacta de un snapshot (para el futuro protocolo de red). */
export function encodeSnapshot(s) {
  return [...s.p, ...s.q, ...s.v, ...s.c, ...s.e, s.g].map((x) => Math.round(x * 1000) / 1000);
}
