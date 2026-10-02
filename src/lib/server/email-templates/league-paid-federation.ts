import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface LeaguePaidFederationEmailInput {
  leagueName: string;
  department: string;
  city: string | null;
  adminName: string;
  adminEmail: string;
  amountCop: number;
  transactionId: string | null;
  paidAt: Date;
  panelUrl: string;
}

export function leaguePaidFederationSubject(leagueName: string): string {
  return `Liga ${leagueName} pagó su afiliación y quedó activa`;
}

/** Aviso a la federación: una liga aprobada pagó la afiliación y se activó sola. */
export function leaguePaidFederationHtml(i: LeaguePaidFederationEmailInput): string {
  const amount = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(i.amountCop);
  const paidAt = i.paidAt.toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short", timeZone: "America/Bogota" });
  const place = i.city ? `${i.city}, ${i.department}` : i.department;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#c9c0b3;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Pago de afiliación recibido</h1>
    <p style="margin:0 0 12px;">
      La <strong>Liga ${escapeHtml(i.leagueName)}</strong> pagó la cuota de afiliación y quedó
      <strong>activa</strong> automáticamente.
    </p>
    <table role="presentation" style="margin:0 0 16px;border-collapse:collapse;">
      ${row("Liga", i.leagueName)}
      ${row("Ubicación", place)}
      ${row("Administrador", `${i.adminName} (${i.adminEmail})`)}
      ${row("Monto", amount)}
      ${row("Fecha del pago", paidAt)}
      ${i.transactionId ? row("Transacción Bold", i.transactionId) : ""}
    </table>
    ${emailButton("Ver en el panel", i.panelUrl)}
  `;
  return emailLayout({ previewText: `La Liga ${i.leagueName} pagó su afiliación (${amount})`, bodyHtml });
}
