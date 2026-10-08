/**
 * Plazo de pago de una carrera. Lo comparten la interfaz y, más adelante, el
 * servidor al crear el link de pago del atleta, para que la regla sea una sola:
 *   - open:   no hay fecha límite, o aún no vence.
 *   - closed: venció. El director de la liga puede extender el plazo de la
 *             carrera (events.payment_deadline) y ahí vuelve a estar abierta.
 */
export type PaymentWindow = "open" | "closed";

/** Fecha de hoy en Colombia (YYYY-MM-DD), independiente de la zona del navegador o del servidor. */
export function bogotaToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** El plazo vence DESPUÉS de su último día: el día de la fecha límite todavía se puede pagar. */
export function isDeadlinePassed(deadline: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(deadline) && bogotaToday(now) > (deadline as string);
}

export function paymentWindow(deadline: string | null | undefined, now: Date = new Date()): PaymentWindow {
  return isDeadlinePassed(deadline, now) ? "closed" : "open";
}
