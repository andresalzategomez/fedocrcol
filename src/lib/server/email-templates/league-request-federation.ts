import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface LeagueRequestFederationEmailInput {
  leagueName: string;
  department: string;
  city: string | null;
  applicantName: string;
  applicantEmail: string;
  panelUrl: string;
}

export function leagueRequestFederationSubject(leagueName: string): string {
  return `Nueva solicitud de liga por aprobar: ${leagueName}`;
}

/** Aviso a la federación: una liga se registró y espera su aprobación. */
export function leagueRequestFederationHtml(i: LeagueRequestFederationEmailInput): string {
  const place = i.city ? `${i.city}, ${i.department}` : i.department;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#c9c0b3;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Hay una solicitud por aprobar</h1>
    <p style="margin:0 0 12px;">
      Una liga nueva se registró y espera la aprobación de la federación. Al aprobarla defines la
      cuota de afiliación y la liga recibe el link de pago por correo.
    </p>
    <table role="presentation" style="margin:0 0 16px;border-collapse:collapse;">
      ${row("Liga", i.leagueName)}
      ${row("Ubicación", place)}
      ${row("Solicitante", i.applicantName)}
      ${row("Correo", i.applicantEmail)}
    </table>
    ${emailButton("Revisar la solicitud", i.panelUrl)}
  `;
  return emailLayout({ previewText: `Nueva solicitud de liga: ${i.leagueName}`, bodyHtml });
}
