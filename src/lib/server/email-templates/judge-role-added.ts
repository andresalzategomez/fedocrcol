import { emailLayout, escapeHtml } from "./layout";

export interface JudgeRoleAddedEmailInput {
  fullName: string;
  leagueName: string;
}

export function judgeRoleAddedSubject(leagueName: string): string {
  return `Ahora eres juez — Liga ${leagueName}`;
}

/**
 * Para una cuenta ya confirmada (con contraseña) a la que se le cambia
 * el rol a juez -- a diferencia de una invitación nueva, no hace falta
 * crear contraseña: ya puede iniciar sesión con la que tiene.
 */
export function judgeRoleAddedHtml({ fullName, leagueName }: JudgeRoleAddedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Cronometraje</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Bienvenido al equipo!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Ahora eres <strong>juez de cronometraje</strong> en la <strong>Liga ${escapeHtml(leagueName)}</strong>,
      dentro de la Federación Colombiana de OCR.
    </p>
    <p style="margin:0 0 12px;">
      Ya puedes iniciar sesión en <strong>FedOCR Timer</strong> con tu correo y tu contraseña actual
      para registrar los tiempos del checkpoint que te asignen.
    </p>
  `;
  return emailLayout({ previewText: `Ahora eres juez en la Liga ${leagueName}`, bodyHtml });
}
