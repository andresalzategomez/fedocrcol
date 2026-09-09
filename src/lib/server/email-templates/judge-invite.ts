import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

export interface JudgeInviteEmailInput {
  fullName: string;
  leagueName: string;
  inviteUrl: string;
}

export function judgeInviteSubject(leagueName: string): string {
  return `Te invitaron a ser juez — Liga ${leagueName}`;
}

export function judgeInviteHtml({ fullName, leagueName, inviteUrl }: JudgeInviteEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Invitación a juez de cronometraje</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Bienvenido al equipo!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Te invitaron a colaborar como <strong>juez de cronometraje</strong> en la
      <strong>Liga ${escapeHtml(leagueName)}</strong>, dentro de la Federación
      Colombiana de OCR.
    </p>
    <p style="margin:0 0 12px;">
      Para empezar, crea tu contraseña. La usarás para iniciar sesión en
      <strong>FedOCR Timer</strong> y registrar los tiempos de los atletas en el
      checkpoint que te asignen.
    </p>
    ${emailButton("Crear mi contraseña", inviteUrl)}
    ${emailFallbackLink(inviteUrl)}
  `;
  return emailLayout({ previewText: `Te invitaron a ser juez en la Liga ${leagueName}`, bodyHtml });
}
