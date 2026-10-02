import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

export interface LeaguePaymentLinkEmailInput {
  fullName: string;
  leagueName: string;
  amountCop: number;
  paymentUrl: string;
  expiresAt: Date;
}

export function leaguePaymentLinkSubject(leagueName: string): string {
  return `Aprobamos tu liga — falta el pago de afiliación (${leagueName})`;
}

export function leaguePaymentLinkHtml({ fullName, leagueName, amountCop, paymentUrl, expiresAt }: LeaguePaymentLinkEmailInput): string {
  const amount = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(amountCop);
  const deadline = expiresAt.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Tu liga fue aprobada!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      La Federación aprobó la solicitud de la <strong>Liga ${escapeHtml(leagueName)}</strong>.
      Para activar tu cuenta falta el pago de la cuota de afiliación:
      <strong>${escapeHtml(amount)}</strong>.
    </p>
    <p style="margin:0 0 12px;">
      El link de pago vence el <strong>${escapeHtml(deadline)}</strong>. Cuando se confirme el pago,
      tu liga se activa automáticamente y te avisamos por correo.
    </p>
    ${emailButton("Pagar la afiliación", paymentUrl)}
    ${emailFallbackLink(paymentUrl)}
  `;
  return emailLayout({ previewText: `Tu liga fue aprobada: falta el pago de afiliación (${amount})`, bodyHtml });
}
