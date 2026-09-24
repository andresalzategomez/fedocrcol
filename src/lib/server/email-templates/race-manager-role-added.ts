import { emailLayout, escapeHtml } from "./layout";

export interface RaceManagerRoleAddedEmailInput {
  fullName: string;
  leagueName: string;
}

export function raceManagerRoleAddedSubject(leagueName: string): string {
  return `Ahora eres gestor de carreras — Liga ${leagueName}`;
}

/**
 * Para una cuenta ya confirmada (con contraseña) a la que se le cambia
 * el rol a gestor de carreras -- a diferencia de una invitación nueva,
 * no hace falta crear contraseña: ya puede iniciar sesión con la que tiene.
 */
export function raceManagerRoleAddedHtml({ fullName, leagueName }: RaceManagerRoleAddedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Gestor de carreras</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Bienvenido al equipo!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Ahora puedes crear y gestionar <strong>carreras</strong> (oficiales o no) para la
      <strong>Liga ${escapeHtml(leagueName)}</strong>, dentro de la Federación Colombiana de OCR.
    </p>
    <p style="margin:0 0 12px;">
      Ya puedes iniciar sesión en el panel administrativo con tu correo y tu contraseña actual.
    </p>
  `;
  return emailLayout({ previewText: `Ahora eres gestor de carreras en la Liga ${leagueName}`, bodyHtml });
}
