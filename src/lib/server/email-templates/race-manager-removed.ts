import { emailLayout, escapeHtml } from "./layout";

export interface RaceManagerRemovedEmailInput {
  fullName: string | null;
  leagueName: string;
}

export function raceManagerRemovedSubject(leagueName: string): string {
  return `Ya no eres gestor de carreras de la Liga ${leagueName}`;
}

export function raceManagerRemovedHtml({ fullName, leagueName }: RaceManagerRemovedEmailInput): string {
  const greeting = fullName ? `Hola <strong>${escapeHtml(fullName)}</strong>,` : "Hola,";
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Aviso de la liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Ya no eres gestor de carreras</h1>
    <p style="margin:0 0 12px;">${greeting}</p>
    <p style="margin:0 0 12px;">
      Te escribimos para avisarte que ya no formas parte de los gestores de
      carreras de la <strong>Liga ${escapeHtml(leagueName)}</strong>. Tu acceso
      al panel administrativo con esta cuenta fue revocado.
    </p>
    <p style="margin:0;">
      Si crees que esto es un error, contacta directamente a la liga.
    </p>
  `;
  return emailLayout({ previewText: `Ya no eres gestor de carreras en la Liga ${leagueName}`, bodyHtml });
}
