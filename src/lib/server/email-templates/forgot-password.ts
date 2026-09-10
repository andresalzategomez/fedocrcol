import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

export interface ForgotPasswordEmailInput {
  fullName: string | null;
  resetUrl: string;
}

export const forgotPasswordSubject = "Recupera tu contraseña — FedOCR Colombia";

export function forgotPasswordHtml({ fullName, resetUrl }: ForgotPasswordEmailInput): string {
  const greeting = fullName ? `Hola <strong>${escapeHtml(fullName)}</strong>,` : "Hola,";
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Recuperación de contraseña</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Restablece tu contraseña</h1>
    <p style="margin:0 0 12px;">${greeting}</p>
    <p style="margin:0 0 12px;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta en
      FedOCR Colombia. Si fuiste tú, crea una nueva contraseña con el botón
      de abajo.
    </p>
    ${emailButton("Restablecer contraseña", resetUrl)}
    ${emailFallbackLink(resetUrl)}
    <p style="margin:16px 0 0;color:#c9c0b3;font-size:12px;">
      Si no solicitaste este cambio, ignora este correo — tu contraseña
      actual sigue funcionando.
    </p>
  `;
  return emailLayout({ previewText: "Restablece tu contraseña de FedOCR Colombia", bodyHtml });
}
