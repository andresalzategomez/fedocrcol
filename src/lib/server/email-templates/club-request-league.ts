import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface ClubRequestLeagueEmailInput {
  leagueName: string;
  clubName: string;
  contactName: string;
  contactEmail: string;
  panelUrl: string;
}

export function clubRequestLeagueSubject(clubName: string): string {
  return `Un club espera tu aprobación: ${clubName}`;
}

/** Aviso al administrador de la liga: un club se registró y espera su aprobación. */
export function clubRequestLeagueHtml(i: ClubRequestLeagueEmailInput): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#c9c0b3;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Clubes</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Hay un club por aprobar</h1>
    <p style="margin:0 0 12px;">
      Un club se registró en la <strong>Liga ${escapeHtml(i.leagueName)}</strong> y espera tu aprobación para quedar activo.
      Puedes revisarlo en la pestaña <strong>Solicitudes</strong> de tu panel.
    </p>
    <table role="presentation" style="margin:0 0 16px;border-collapse:collapse;">
      ${row("Club", i.clubName)}
      ${row("Contacto", i.contactName)}
      ${row("Correo", i.contactEmail)}
    </table>
    ${emailButton("Revisar la solicitud", i.panelUrl)}
  `;
  return emailLayout({ previewText: `Nuevo club por aprobar: ${i.clubName}`, bodyHtml });
}
