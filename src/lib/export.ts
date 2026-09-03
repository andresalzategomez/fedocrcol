import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

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
  autoTable(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ""))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [45, 228, 127], textColor: [11, 15, 30] },
  });
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
