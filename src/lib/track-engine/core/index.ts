/**
 * Núcleo del motor de reglas de Timer_track.
 * TypeScript puro, sin dependencias externas ni APIs del navegador. Determinista.
 * Requiere un entorno con structuredClone (Node 17+, navegadores modernos, Workers).
 * Documentación: docs/ENGINE.md
 */

export const ENGINE_VERSION = '0.1.0';

export * from './events';
export * from './golden';
export * from './pairing';
export * from './ranking';
export * from './reducer';
export * from './selectors';
export * from './time';
export * from './types';
