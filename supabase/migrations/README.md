# Migraciones — Supabase externo

Estas migraciones ya fueron **aplicadas** al proyecto Supabase
`Federacion OCR Colombia` (ref `wpnbrerwcmcwgvqyepby`). Se conservan aquí como
historial versionado. Todas son **idempotentes** (seguras de re-ejecutar).

| Archivo | Contenido | Estado |
|---------|-----------|--------|
| `0001_baseline.sql` | Marcador. La base es `../schema.sql`. | — |
| `0002_timing.sql` | Cronometraje: waves, checkpoints, timing_reads, api_keys, dorsal/oleada y consolidación de resultados. | ✅ aplicada |
| `0003_clubs_affiliations_categories.sql` | Clubes, afiliaciones/carnet y catálogo nacional de categorías (11 sembradas). | ✅ aplicada |
| `0004_harden_functions.sql` | Refuerzo de seguridad de funciones (search_path + EXECUTE). | ✅ aplicada |
| `0005_timer_contract_reconciliation.sql` | Ajustes para el contrato del Timer: `waves.wave_number`/`status`, `results.penalty_seconds`, `timing_reads.client_record_id`. | ✅ aplicada |
| `0006_results_source_guard.sql` | `results.source`; el recálculo no sobrescribe resultados del Timer. | ✅ aplicada |

`../schema.sql` es el **snapshot consolidado** (contiene todo). En una base nueva
basta con ejecutar `schema.sql`; en una base existente, aplica solo las migraciones
que falten (o usa el conector de Supabase / `supabase db push`).

> La API que consume el Timer vive en `src/routes/api/v1/` (server routes de
> TanStack Start). Ver `docs/TIMER_INTEGRATION.md`.
