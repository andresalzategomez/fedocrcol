/**
 * Envoltorio HTML compartido por los correos transaccionales de FedOCR
 * Colombia (enviados vía Resend, ver ../resend-server.ts). Tabla + estilos
 * inline a propósito: es el único subset de CSS que renderiza igual en
 * Gmail/Outlook/Apple Mail. Los colores replican los tokens de marca de
 * src/styles.css (oklch) en hex, y --primary coincide con el
 * tenants.primary_color por defecto del esquema (#F0562A).
 */
const BRAND = {
  bg: "#0f0d0b",
  card: "#1a1510",
  border: "#33291f",
  text: "#f5f0e8",
  muted: "#c9c0b3",
  primary: "#F0562A",
  primaryText: "#160f0a",
};

export function emailLayout(opts: { previewText: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FedOCR Colombia</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.previewText)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid ${BRAND.border};">
                <span style="color:${BRAND.primary};font-size:20px;font-weight:800;">&#9650;</span>
                <span style="color:${BRAND.text};font-size:18px;font-weight:800;letter-spacing:0.03em;text-transform:uppercase;margin-left:6px;">
                  Fed<span style="color:${BRAND.primary};">OCR</span>
                </span>
                <span style="color:${BRAND.muted};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;margin-left:6px;">Colombia</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:${BRAND.text};font-size:15px;line-height:1.6;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.5;">
                Federación Colombiana de OCR — este es un correo automático, no respondas a esta dirección.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function emailButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr>
      <td style="border-radius:8px;background-color:${BRAND.primary};">
        <a href="${url}" style="display:inline-block;padding:14px 28px;color:${BRAND.primaryText};font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.03em;text-decoration:none;border-radius:8px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

export function emailFallbackLink(url: string): string {
  return `<p style="margin:0 0 4px;color:${BRAND.muted};font-size:12px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
  <p style="margin:0;word-break:break-all;"><a href="${url}" style="color:${BRAND.primary};font-size:12px;">${url}</a></p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
