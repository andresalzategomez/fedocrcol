import { emailLayout, escapeHtml } from "./layout";

export interface JudgeCrossLeagueAddedEmailInput {
  fullName: string;
  leagueName: string;
}

export function judgeCrossLeagueAddedSubject(leagueName: string): string {
  return `Ahora también eres juez de la Liga ${leagueName}`;
}

/**
 * Para un juez YA dedicado a otra liga, al que se agrega como juez
 * adicional de ESTA liga (ver migraciones 0026/0028): no cambia de
 * liga de origen ni pierde nada ahí, solo puede ADEMÁS cronometrar
 * en checkpoints de esta liga si lo asignan.
 */
export function judgeCrossLeagueAddedHtml({ fullName, leagueName }: JudgeCrossLeagueAddedEmailInput): string {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Cronometraje</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Nueva liga para cronometrar</h1>
    <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
    <p style="margin:0 0 12px;">
      Ahora también apareces como juez en la <strong>Liga ${escapeHtml(leagueName)}</strong>, para que te
      puedan asignar a un checkpoint de sus carreras. Sigues siendo juez de tu liga de origen igual que antes.
    </p>
    <p style="margin:0 0 12px;">
      Inicia sesión en <strong>FedOCR Timer</strong> con tu mismo correo y contraseña para registrar los
      tiempos del checkpoint que te asignen, en cualquiera de las dos ligas.
    </p>
  `;
  return emailLayout({ previewText: `Ahora también eres juez en la Liga ${leagueName}`, bodyHtml });
}
