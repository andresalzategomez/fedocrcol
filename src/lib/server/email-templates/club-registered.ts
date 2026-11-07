import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface ClubRegisteredEmailInput {
  fullName: string;
  clubName: string;
  leagueName: string;
  panelUrl: string;
}

export function clubRegisteredSubject(clubName: string): string {
  return `Recibimos el registro de ${clubName}`;
}

/** Acuse al club: su registro quedó pendiente de la aprobación de la liga. */
export function clubRegisteredHtml(i: ClubRegisteredEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Clubes</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Registro recibido</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(i.fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Registramos a <strong>${escapeHtml(i.clubName)}</strong> y avisamos a la <strong>Liga ${escapeHtml(i.leagueName)}</strong>,
      que debe aprobar tu club antes de que pueda operar. Te escribiremos en cuanto haya una respuesta.
    </p>
    ${emailButton("Ir a mi panel", i.panelUrl)}
  `;
  return emailLayout({ previewText: `Registro recibido: ${i.clubName}`, bodyHtml });
}
