import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface LeagueActivatedEmailInput {
  fullName: string;
  leagueName: string;
  panelUrl: string;
}

export function leagueActivatedSubject(leagueName: string): string {
  return `Tu liga ya está activa — ${leagueName}`;
}

export function leagueActivatedHtml({ fullName, leagueName, panelUrl }: LeagueActivatedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Pago confirmado!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Recibimos el pago de la afiliación y la <strong>Liga ${escapeHtml(leagueName)}</strong> ya está
      activa. Ya puedes entrar a tu panel para crear carreras, invitar jueces y gestionar tu liga.
    </p>
    ${emailButton("Ir a mi panel", panelUrl)}
  `;
  return emailLayout({ previewText: `La Liga ${leagueName} ya está activa`, bodyHtml });
}
