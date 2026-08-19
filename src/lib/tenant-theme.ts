import { useEffect } from "react";

/**
 * ThemeService (equivalente al servicio Angular pedido):
 * inyecta CSS Custom Properties del tenant activo en el DOM,
 * sobrescribiendo los colores base del template.
 */
function hexToOklchString(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(A * A + B * B);
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return `oklch(${L.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

function readableForeground(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "oklch(0.16 0.012 60)" : "oklch(0.98 0.005 80)";
}

export type TenantBranding = {
  primary_color: string;
  secondary_color: string;
} | null;

export function applyTenantTheme(branding: TenantBranding) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const props = ["--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--ring"];

  if (!branding) {
    props.forEach((p) => root.style.removeProperty(p));
    return;
  }

  root.style.setProperty("--primary", hexToOklchString(branding.primary_color));
  root.style.setProperty("--primary-foreground", readableForeground(branding.primary_color));
  root.style.setProperty("--secondary", hexToOklchString(branding.secondary_color));
  root.style.setProperty("--secondary-foreground", readableForeground(branding.secondary_color));
  root.style.setProperty("--ring", hexToOklchString(branding.primary_color));
}

export function useTenantTheme(branding: TenantBranding) {
  useEffect(() => {
    applyTenantTheme(branding);
    return () => applyTenantTheme(null);
  }, [branding?.primary_color, branding?.secondary_color]);
}
