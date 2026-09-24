import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

export interface AthleteConfirmEmailInput {
  fullName: string;
  confirmUrl: string;
}

export const athleteConfirmSubject = "Confirma tu correo — FedOCR Colombia";

export function athleteConfirmHtml({ fullName, confirmUrl }: AthleteConfirmEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Confirmación de cuenta</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Ya casi estás!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Gracias por registrarte en FedOCR Colombia. Confirma tu correo con el
      botón de abajo para activar tu cuenta e iniciar sesión.
    </p>
    ${emailButton("Confirmar mi correo", confirmUrl)}
    ${emailFallbackLink(confirmUrl)}
  `;
  return emailLayout({ previewText: "Confirma tu correo para activar tu cuenta en FedOCR Colombia", bodyHtml });
}
