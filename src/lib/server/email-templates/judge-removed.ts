import { emailLayout, escapeHtml } from "./layout";

export interface JudgeRemovedEmailInput {
  fullName: string | null;
  leagueName: string;
}

export function judgeRemovedSubject(leagueName: string): string {
  return `Ya no eres juez de la Liga ${leagueName}`;
}

export function judgeRemovedHtml({ fullName, leagueName }: JudgeRemovedEmailInput): string {
  const greeting = fullName ? `Hola <strong>${escapeHtml(fullName)}</strong>,` : "Hola,";
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#c9c0b3;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Aviso de la liga</p>
    <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;text-transform:uppercase;letter-spacing:0.01em;">Ya no eres juez</h1>
    <p style="margin:0 0 12px;">${greeting}</p>
    <p style="margin:0 0 12px;">
      Te escribimos para avisarte que ya no formas parte de los jueces de
      cronometraje de la <strong>Liga ${escapeHtml(leagueName)}</strong>. Tu acceso
      a FedOCR Timer con esta cuenta fue revocado.
    </p>
    <p style="margin:0;">
      Si crees que esto es un error, contacta directamente a la liga.
    </p>
  `;
  return emailLayout({ previewText: `Ya no eres juez en la Liga ${leagueName}`, bodyHtml });
}
