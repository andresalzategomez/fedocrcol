import { emailLayout, emailButton, emailFallbackLink, escapeHtml } from "./layout";

const cop = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
const eyebrow = `<p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Cuota de club</p>`;
const title = (t: string) => `<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">${escapeHtml(t)}</h1>`;

// ---------------------------------------------------------------- link de pago (al club)
export interface ClubPaymentLinkInput {
  fullName: string; clubName: string; leagueName: string; season: number;
  amountCop: number; paymentUrl: string; expiresAt: Date; renewal: boolean;
}

export function clubPaymentLinkSubject(i: Pick<ClubPaymentLinkInput, "clubName" | "season" | "renewal">): string {
  return i.renewal
    ? `Renueva tu club para la temporada ${i.season}: ${i.clubName}`
    : `Aprobaron tu club — falta el pago de la temporada ${i.season} (${i.clubName})`;
}

export function clubPaymentLinkHtml(i: ClubPaymentLinkInput): string {
  const deadline = i.expiresAt.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
  const intro = i.renewal
    ? `Comenzó la <strong>temporada ${i.season}</strong> de la <strong>Liga ${escapeHtml(i.leagueName)}</strong>. Para que <strong>${escapeHtml(i.clubName)}</strong> siga activo hay que renovar la cuota:`
    : `La <strong>Liga ${escapeHtml(i.leagueName)}</strong> aprobó a <strong>${escapeHtml(i.clubName)}</strong>. Para dejarlo activo en la <strong>temporada ${i.season}</strong> falta el pago de la cuota:`;
  const bodyHtml = `
    ${eyebrow}
    ${title(i.renewal ? "Renueva tu club" : "¡Tu club fue aprobado!")}
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(i.fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">${intro} <strong>${escapeHtml(cop(i.amountCop))}</strong>.</p>
    <p style="margin:0 0 12px;">
      El link de pago vence el <strong>${escapeHtml(deadline)}</strong>. Sin el pago el club no aparece en la liga ni sus atletas
      pueden elegirlo. Cuando se confirme, tu club queda activo automáticamente y te avisamos por correo.
    </p>
    ${emailButton("Pagar la cuota", i.paymentUrl)}
    ${emailFallbackLink(i.paymentUrl)}
  `;
  return emailLayout({ previewText: `Cuota de club temporada ${i.season}: ${cop(i.amountCop)}`, bodyHtml });
}

// ---------------------------------------------------------------- club activo (al club)
export interface ClubActivatedInput { fullName: string; clubName: string; leagueName: string; season: number; panelUrl: string; exempt?: boolean }

export function clubActivatedSubject(i: Pick<ClubActivatedInput, "clubName" | "season">): string {
  return `Tu club está activo en la temporada ${i.season}: ${i.clubName}`;
}

export function clubActivatedHtml(i: ClubActivatedInput): string {
  const intro = i.exempt
    ? `La <strong>Liga ${escapeHtml(i.leagueName)}</strong> te exoneró de la cuota de la temporada ${i.season}: <strong>${escapeHtml(i.clubName)}</strong> ya está activo.`
    : `Recibimos el pago de la cuota y <strong>${escapeHtml(i.clubName)}</strong> ya está activo en la <strong>Liga ${escapeHtml(i.leagueName)}</strong> para la temporada ${i.season}.`;
  const bodyHtml = `
    ${eyebrow}
    ${title(i.exempt ? "¡Club activo!" : "¡Pago confirmado!")}
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(i.fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">${intro} Tus atletas ya pueden elegirlo al registrarse.</p>
    ${emailButton("Ir a mi panel", i.panelUrl)}
  `;
  return emailLayout({ previewText: `${i.clubName} está activo en la temporada ${i.season}`, bodyHtml });
}

// ---------------------------------------------------------------- aviso a la liga (club pagó / exonerado)
export interface ClubPaidLeagueInput { leagueName: string; clubName: string; season: number; amountCop: number; exempt: boolean; panelUrl: string }

export function clubPaidLeagueSubject(i: Pick<ClubPaidLeagueInput, "clubName" | "exempt">): string {
  return i.exempt ? `Club activado sin cobro: ${i.clubName}` : `Un club pagó su cuota: ${i.clubName}`;
}

export function clubPaidLeagueHtml(i: ClubPaidLeagueInput): string {
  const bodyHtml = `
    ${eyebrow}
    ${title(i.exempt ? "Club activado sin cobro" : "Un club pagó su cuota")}
    <p style="margin:0 0 12px;">
      <strong>${escapeHtml(i.clubName)}</strong> quedó activo en la <strong>Liga ${escapeHtml(i.leagueName)}</strong> para la
      <strong>temporada ${i.season}</strong>${i.exempt ? " (exonerado de la cuota)" : ` con un pago de <strong>${escapeHtml(cop(i.amountCop))}</strong>`}.
    </p>
    ${emailButton("Ver clubes de la temporada", i.panelUrl)}
  `;
  return emailLayout({ previewText: `${i.clubName} activo en la temporada ${i.season}`, bodyHtml });
}
