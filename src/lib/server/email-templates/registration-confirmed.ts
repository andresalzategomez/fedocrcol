import { emailLayout, escapeHtml } from "./layout";

export interface RegistrationConfirmedEmailInput {
  fullName: string;
  eventTitle: string;
  categoryName: string;
  qrCode: string;
  amount: number;
}

export function registrationConfirmedSubject(eventTitle: string): string {
  return `Inscripción registrada — ${eventTitle}`;
}

function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

export function registrationConfirmedHtml({ fullName, eventTitle, categoryName, qrCode, amount }: RegistrationConfirmedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Confirmación de inscripción</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Ya casi estás en la línea de salida!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Tu inscripción a <strong>${escapeHtml(eventTitle)}</strong>, categoría
      <strong>${escapeHtml(categoryName)}</strong>, quedó registrada.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #33291f;border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;color:#c9c0b3;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Código de inscripción</p>
          <p style="margin:0 0 12px;font-family:monospace;font-size:14px;">${escapeHtml(qrCode)}</p>
          <p style="margin:0 0 4px;color:#c9c0b3;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Valor</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#F0562A;">${escapeHtml(formatCOP(amount))}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;">
      Tu cupo queda reservado como <strong>pendiente</strong> mientras se confirma el
      pago. Te avisaremos por correo en cuanto quede aprobado.
    </p>
  `;
  return emailLayout({ previewText: `Tu inscripción a ${eventTitle} quedó registrada`, bodyHtml });
}
