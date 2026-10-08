import { emailLayout, escapeHtml } from "./layout";

export interface RegistrationPaidEmailInput {
  fullName: string;
  eventTitle: string;
  categoryName: string;
  qrCode: string;
  amount: number;
}

export function registrationPaidSubject(eventTitle: string): string {
  return `Pago confirmado — ${eventTitle}`;
}

function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

export function registrationPaidHtml({ fullName, eventTitle, categoryName, qrCode, amount }: RegistrationPaidEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Pago confirmado</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">¡Estás inscrito!</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Recibimos tu pago y tu cupo en <strong>${escapeHtml(eventTitle)}</strong>${categoryName ? `, categoría <strong>${escapeHtml(categoryName)}</strong>,` : ""}
      quedó <strong>confirmado</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #33291f;border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;color:#c9c0b3;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Código de inscripción</p>
          <p style="margin:0 0 12px;font-family:monospace;font-size:14px;">${escapeHtml(qrCode)}</p>
          <p style="margin:0 0 4px;color:#c9c0b3;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Valor pagado</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#F0562A;">${escapeHtml(formatCOP(amount))}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;">Guarda este código: lo necesitarás para reclamar tu kit y entrar a la línea de salida.</p>
  `;
  return emailLayout({ previewText: `Pago confirmado: estás inscrito en ${eventTitle}`, bodyHtml });
}
