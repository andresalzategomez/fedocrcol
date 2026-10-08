import { emailLayout, emailButton, escapeHtml } from "./layout";

export interface RegistrationPaidAdminEmailInput {
  eventTitle: string;
  categoryName: string;
  athleteName: string;
  athleteDocument: string | null;
  amount: number;
  paidCount: number;
  panelUrl: string;
}

export function registrationPaidAdminSubject(eventTitle: string, athleteName: string): string {
  return `Nuevo atleta inscrito en ${eventTitle}: ${athleteName}`;
}

function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

/** Aviso al administrador de la liga: un atleta pagó y su inscripción quedó confirmada. */
export function registrationPaidAdminHtml(i: RegistrationPaidAdminEmailInput): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#c9c0b3;">${escapeHtml(label)}</td><td style="padding:4px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Inscripciones</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Nuevo atleta inscrito</h1>
    <p style="margin:0 0 12px;">
      <strong>${escapeHtml(i.athleteName)}</strong> pagó su inscripción a <strong>${escapeHtml(i.eventTitle)}</strong> y quedó confirmada.
    </p>
    <table role="presentation" style="margin:0 0 16px;border-collapse:collapse;">
      ${row("Atleta", i.athleteName)}
      ${i.athleteDocument ? row("Documento", i.athleteDocument) : ""}
      ${i.categoryName ? row("Categoría", i.categoryName) : ""}
      ${row("Valor pagado", formatCOP(i.amount))}
      ${row("Inscritos pagados en la carrera", String(i.paidCount))}
    </table>
    ${emailButton("Ver inscritos", i.panelUrl)}
  `;
  return emailLayout({ previewText: `${i.athleteName} se inscribió en ${i.eventTitle}`, bodyHtml });
}
