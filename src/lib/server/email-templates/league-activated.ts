import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface LeagueActivatedEmailInput {
  fullName: string;
  leagueName: string;
  panelUrl: string;
  /** La federación la eximió del pago de afiliación (no hubo cobro en Bold). */
  exempt?: boolean;
}

export function leagueActivatedSubject(leagueName: string): string {
  return `Tu liga ya está activa — ${leagueName}`;
}

export function leagueActivatedHtml({ fullName, leagueName, panelUrl, exempt }: LeagueActivatedEmailInput): string {
  const intro = exempt
    ? `La federación aprobó tu solicitud y te <strong>eximió del pago de la afiliación</strong>: la <strong>Liga ${escapeHtml(leagueName)}</strong> ya está activa.`
    : `Recibimos el pago de la afiliación y la <strong>Liga ${escapeHtml(leagueName)}</strong> ya está activa.`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">${exempt ? "¡Liga aprobada!" : "¡Pago confirmado!"}</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      ${intro} Ya puedes entrar a tu panel para crear carreras, invitar jueces y gestionar tu liga.
    </p>
    ${emailButton("Ir a mi panel", panelUrl)}
  `;
  return emailLayout({ previewText: `La Liga ${leagueName} ya está activa`, bodyHtml });
}
