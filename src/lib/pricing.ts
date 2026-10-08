/**
 * Tarifa dinámica por fecha (preventa -> tarifa plena). Se calcula igual en el
 * navegador (para mostrar el precio) y en el servidor (para cobrar: el monto
 * que manda el cliente nunca se usa para cobrar).
 *
 * `now` es el momento de referencia: al cobrar se usa la fecha en que el atleta
 * se inscribió, así que el precio queda fijo desde ese día aunque pague después.
 * La fecha de la carrera se interpreta en hora de Colombia, igual en cualquier zona.
 */
export function dynamicPrice(basePrice: number, eventDate: string, now: Date = new Date()) {
  const days = Math.ceil((new Date(`${eventDate}T12:00:00-05:00`).getTime() - now.getTime()) / 86400000);
  if (days > 90) return { price: Math.round(basePrice * 0.75), stage: "Preventa 1 (-25%)" };
  if (days > 45) return { price: Math.round(basePrice * 0.85), stage: "Preventa 2 (-15%)" };
  if (days > 15) return { price: Math.round(basePrice * 0.95), stage: "Preventa 3 (-5%)" };
  return { price: basePrice, stage: "Tarifa plena" };
}
