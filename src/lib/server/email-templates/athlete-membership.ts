import { emailLayout, emailButton, escapeHtml } from "./layout";

const cop = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export interface AthleteMembershipEmailInput {
  fullName: string;
  leagueName: string;
  season: number;
  amountCop: number;
  exempt: boolean;
  panelUrl: string;
}

export function athleteMembershipSubject(i: Pick<AthleteMembershipEmailInput, "leagueName" | "season">): string {
  return `Ya estás afiliado a la Liga ${i.leagueName} — temporada ${i.season}`;
}

/** Aviso al atleta: su afiliación a la liga en la temporada quedó confirmada (pago o exoneración). */
export function athleteMembershipHtml(i: AthleteMembershipEmailInput): string {
  const intro = i.exempt
    ? `La <strong>Liga ${escapeHtml(i.leagueName)}</strong> te exoneró de la cuota de afiliación de la <strong>temporada ${i.season}</strong>.`
    : `Recibimos el pago de tu afiliación (<strong>${escapeHtml(cop(i.amountCop))}</strong>) a la <strong>Liga ${escapeHtml(i.leagueName)}</strong> para la <strong>temporada ${i.season}</strong>.`;
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Afiliación de atleta</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">${i.exempt ? "¡Afiliación confirmada!" : "¡Pago confirmado!"}</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(i.fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">${intro} Ya perteneces a la liga en esta temporada.</p>
    ${emailButton("Ir a mi perfil", i.panelUrl)}
  `;
  return emailLayout({ previewText: `Afiliación confirmada: Liga ${i.leagueName}, temporada ${i.season}`, bodyHtml });
}
