import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import * as autoTableModule from "jspdf-autotable";

type AutoTableFn = (doc: jsPDF, options: Record<string, unknown>) => void;

/**
 * jspdf-autotable se publica como UMD/CommonJS: según el empaquetador (Vite en desarrollo, Rollup en
 * producción) el `import` por defecto llega como la función o como un objeto que la trae en `.default` o
 * `.autoTable`. Se resuelve de cualquiera de esas formas en vez de depender de una sola.
 */
function resolveAutoTable(): AutoTableFn {
  const mod = autoTableModule as unknown as Record<string, unknown>;
  const def = mod["default"] as Record<string, unknown> | undefined;
  const fn = [mod["autoTable"], mod["default"], def?.["default"], def?.["autoTable"]].find((c) => typeof c === "function");
  if (!fn) throw new Error("No se pudo cargar el generador de tablas PDF");
  return fn as AutoTableFn;
}

export interface Column {
  header: string;
  key: string;
}

type Row = Record<string, unknown>;

/** Exporta una o varias hojas a un archivo .xlsx. */
export function exportExcel(filename: string, sheets: { name: string; columns: Column[]; rows: Row[] }[]) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const data = s.rows.map((r) => {
      const o: Row = {};
      s.columns.forEach((c) => (o[c.header] = r[c.key] ?? ""));
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: s.columns.map((c) => c.header) });
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** Exporta una tabla a un archivo .pdf (con título). */
export function exportPDF(filename: string, title: string, columns: Column[], rows: Row[]) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString("es-CO"), 14, 21);
  resolveAutoTable()(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ""))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [45, 228, 127], textColor: [11, 15, 30] },
  });
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
