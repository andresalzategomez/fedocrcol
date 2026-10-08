/**
 * Plazo de pago de una inscripción. Lo comparten la interfaz y, más adelante,
 * el servidor al crear el link de pago, para que la regla sea una sola:
 *   - open:         no hay fecha límite, o aún no vence.
 *   - late_allowed: venció, pero el director de la liga dio permiso extemporáneo.
 *   - closed:       venció y no hay permiso: no se puede pagar.
 */
export type PaymentWindow = "open" | "late_allowed" | "closed";

/** Fecha de hoy en Colombia (YYYY-MM-DD), independiente de la zona del navegador o del servidor. */
export function bogotaToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** El plazo vence DESPUÉS de su último día: el día de la fecha límite todavía se puede pagar. */
export function isDeadlinePassed(deadline: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(deadline) && bogotaToday(now) > (deadline as string);
}

export function paymentWindow(
  deadline: string | null | undefined,
  lateGrantedAt: string | null | undefined,
  now: Date = new Date(),
): PaymentWindow {
  if (!isDeadlinePassed(deadline, now)) return "open";
  return lateGrantedAt ? "late_allowed" : "closed";
}
