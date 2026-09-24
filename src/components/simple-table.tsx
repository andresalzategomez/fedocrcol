import { Children, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const TABLE_PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Tabla con paginación client-side (10/20/50/100 por página, 10 por
 * defecto). `children` debe ser una lista de <TableRow>, una fila por
 * registro -- el mismo patrón en todas las tablas de la app.
 */
export function SimpleTable({ head, children }: { head: string[]; children: ReactNode }) {
  const items = Children.toArray(children);
  const [pageSize, setPageSize] = useState<number>(TABLE_PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * pageSize, current * pageSize + pageSize);
  useEffect(() => { setPage(0); }, [pageSize, total]);

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{head.map((h, i) => <TableHead key={i} className={i === head.length - 1 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{slice}</TableBody>
      </Table>
      {total > TABLE_PAGE_SIZES[0] ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Ver</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{TABLE_PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-muted-foreground">de {total} registros</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</Button>
            <span className="text-muted-foreground">Página {current + 1} de {pages}</span>
            <Button size="sm" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Siguiente</Button>
          </div>
        </div>
      ) : null}
    </CardContent></Card>
  );
}
