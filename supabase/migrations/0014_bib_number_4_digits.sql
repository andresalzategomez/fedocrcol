-- =====================================================================
-- 0014 — Dorsal (bib_number) de 4 dígitos con ceros a la izquierda
-- Idempotente.
--
-- El dorsal se exporta desde el panel para mandar a fabricar las
-- manillas/números físicos de la carrera, así que el formato "0001"
-- tiene que vivir en el dato guardado, no solo en cómo se muestra.
-- `bib_number` pasa de `int` a `text`, conservando el valor numérico con
-- padStart(4,'0'). La asignación sigue siendo consecutiva (1,2,3...);
-- solo cambia cómo queda guardado el número.
--
-- Nota para quien toque esto después: el contrato de /api/v1 ya
-- devolvía `bib_number` sin castear, así que ahora entrega el string
-- con ceros — el Timer ya lo vuelve texto de todas formas al guardarlo
-- localmente (`String(a.bib_number)`), así que no rompe esa vía. El
-- único punto sensible es time-records.batch.ts: el Timer sigue
-- enviando el dorsal como número al hacer push (su coerceBib lo
-- normaliza así), así que el matching ahí parsea ambos lados a entero
-- en vez de comparar el string guardado — ver ese archivo.
-- =====================================================================

do $$
begin
  if (
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'registrations' and column_name = 'bib_number'
  ) = 'integer' then
    alter table public.registrations
      alter column bib_number type text
      using (case when bib_number is null then null else lpad(bib_number::text, 4, '0') end);
  end if;
end $$;
