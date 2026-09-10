import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

export interface RaceManagerInviteEmailInput {
  fullName: string;
  leagueName: string;
  inviteUrl: string;
}

export function raceManagerInviteSubject(leagueName: string): string {
  return `Te invitaron a crear carreras — Liga ${leagueName}`;
}

export function raceManagerInviteHtml({ fullName, leagueName, inviteUrl }: RaceManagerInviteEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Invitación a gestor de carreras</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Bienvenido al equipo!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Te invitaron a crear y gestionar <strong>carreras</strong> (oficiales o no) para la
      <strong>Liga ${escapeHtml(leagueName)}</strong>, dentro de la Federación
      Colombiana de OCR.
    </p>
    <p style="margin:0 0 12px;">
      Para empezar, crea tu contraseña. La usarás para iniciar sesión en el
      panel administrativo de FedOCR Colombia.
    </p>
    ${emailButton("Crear mi contraseña", inviteUrl)}
    ${emailFallbackLink(inviteUrl)}
  `;
  return emailLayout({ previewText: `Te invitaron a crear carreras en la Liga ${leagueName}`, bodyHtml });
}
