import { emailLayout, escapeHtml } from "./layout";

export interface JudgeAdminAddedEmailInput {
  fullName: string;
  leagueName: string;
}

export function judgeAdminAddedSubject(leagueName: string): string {
  return `Ahora también apareces como juez — Liga ${leagueName}`;
}

/**
 * Para un admin (o superadmin) que se agrega como juez adicional de su
 * liga: a diferencia de la invitación normal, NO le cambia el rol ni le
 * pide crear contraseña -- ya tiene cuenta y acceso, esto solo avisa.
 */
export function judgeAdminAddedHtml({ fullName, leagueName }: JudgeAdminAddedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Cronometraje</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Ya puedes cronometrar</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Ahora también apareces en la lista de jueces de la <strong>Liga ${escapeHtml(leagueName)}</strong>,
      para que te puedan asignar a un checkpoint. Tu cuenta y tu rol de administrador no cambian.
    </p>
    <p style="margin:0 0 12px;">
      Inicia sesión en <strong>FedOCR Timer</strong> con tu mismo correo y contraseña para registrar
      los tiempos del checkpoint que te asignen.
    </p>
  `;
  return emailLayout({ previewText: `Ahora también apareces como juez en la Liga ${leagueName}`, bodyHtml });
}
