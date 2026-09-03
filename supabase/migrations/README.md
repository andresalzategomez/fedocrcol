# Migraciones — Supabase externo

Aplicadas al proyecto Supabase `Federacion OCR Colombia` (ref `wpnbrerwcmcwgvqyepby`).
Historial versionado. Todas **idempotentes** (seguras de re-ejecutar).

| Archivo | Contenido | Estado |
|---------|-----------|--------|
| `0001_baseline.sql` | Marcador. La base es `../schema.sql`. | — |
| `0002_timing.sql` | Cronometraje: waves, checkpoints, timing_reads, api_keys, dorsal/oleada, consolidación de resultados. | ✅ |
| `0003_clubs_affiliations_categories.sql` | Clubes, afiliaciones/carnet y catálogo de categorías (11 sembradas). | ✅ |
| `0004_harden_functions.sql` | Refuerzo de seguridad de funciones. | ✅ |
| `0005_timer_contract_reconciliation.sql` | `waves.wave_number`/`status`, `results.penalty_seconds`, `timing_reads.client_record_id`. | ✅ |
| `0006_results_source_guard.sql` | `results.source`; el recálculo no pisa resultados del Timer. | ✅ |
| `0007_results_athlete_nullable.sql` | `results.athlete_id` nullable (inscripciones de invitado). | ✅ |
| `0008_fix_recalc_onconflict_partial_index.sql` | Fix `ON CONFLICT` con índice parcial en `recalculate_result` (evita 42P10). | ✅ |

`../schema.sql` es el **snapshot consolidado**. En una base nueva basta con ejecutarlo;
en una existente, aplica solo las migraciones que falten.

> La API que consume el Timer vive en `src/routes/api/v1/`. Ver `docs/TIMER_INTEGRATION.md`.
> Probada end-to-end (health, login, pull de carrera/oleadas/splits/atletas, push idempotente).
