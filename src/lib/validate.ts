/**
 * Validaciones reutilizables para los formularios del panel.
 * Cada validador devuelve un mensaje de error (string) o null si es válido.
 */

export type Validator = (value: string) => string | null;

export const required =
  (label = "Este campo"): Validator =>
  (v) => (v == null || String(v).trim() === "" ? `${label} es obligatorio` : null);

export const minLen =
  (n: number, label = "Este campo"): Validator =>
  (v) => (String(v).trim().length < n ? `${label} debe tener al menos ${n} caracteres` : null);

/** Solo dígitos (documento, número). Opcionalmente exige longitud mínima. */
export const numeric =
  (label = "Este campo", min = 1): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return `${label} es obligatorio`;
    if (!/^\d+$/.test(s)) return `${label} solo admite números`;
    if (s.length < min) return `${label} no es válido`;
    return null;
  };

/** Entero positivo (dorsal, cupos, orden, etc.). */
export const positiveInt =
  (label = "Este campo"): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return `${label} es obligatorio`;
    if (!/^\d+$/.test(s) || Number(s) <= 0) return `${label} debe ser un entero mayor que 0`;
    return null;
  };

/** Número decimal ≥ 0 (distancia km, precio). */
export const decimalNonNeg =
  (label = "Este campo"): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return null; // opcional
    if (!/^\d+(\.\d+)?$/.test(s) || Number(s) < 0) return `${label} debe ser un número válido`;
    return null;
  };

/** Teléfono Colombia: celular de 10 dígitos (empieza en 3) o fijo 7 dígitos; admite +57 y separadores. */
export const phoneCO =
  (label = "El teléfono"): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return null; // opcional salvo que se combine con required
    const digits = s.replace(/[\s\-()]/g, "").replace(/^\+?57/, "");
    if (!/^\d+$/.test(digits)) return `${label} solo admite números`;
    if (!(digits.length === 10 && digits.startsWith("3")) && digits.length !== 7)
      return `${label} debe ser un celular (10 dígitos) o fijo (7 dígitos)`;
    return null;
  };

export const email =
  (label = "El correo"): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? null : `${label} no es válido`;
  };

/** slug: minúsculas, números y guiones. */
export const slug =
  (label = "El slug"): Validator =>
  (v) => {
    const s = String(v).trim();
    if (s === "") return `${label} es obligatorio`;
    return /^[a-z0-9-]+$/.test(s) ? null : `${label} solo admite minúsculas, números y guiones`;
  };

/** Ejecuta varios validadores y devuelve el primer error. */
export function firstError(value: string, validators: Validator[]): string | null {
  for (const val of validators) {
    const e = val(value);
    if (e) return e;
  }
  return null;
}

/**
 * Valida un objeto de campos contra un mapa de validadores.
 * Devuelve { ok, errors } donde errors[campo] = mensaje.
 */
export function validateForm<T extends Record<string, string>>(
  values: T,
  rules: Partial<Record<keyof T, Validator[]>>,
): { ok: boolean; errors: Partial<Record<keyof T, string>> } {
  const errors: Partial<Record<keyof T, string>> = {};
  (Object.keys(rules) as (keyof T)[]).forEach((k) => {
    const e = firstError(values[k] ?? "", rules[k] ?? []);
    if (e) errors[k] = e;
  });
  return { ok: Object.keys(errors).length === 0, errors };
}
