/**
 * Verificador de casos dorados para usar fuera de Timer_track (por ejemplo, en fedocrcol).
 * Solo depende del núcleo y de Node.
 *
 * Uso: npx tsx run-golden.ts [carpeta-con-json]
 * Sale con código 1 si algún caso no coincide.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, runGoldenCase, type GoldenCase } from '../src/lib/track-engine/core';

const dir = process.argv[2] ?? 'golden';
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
let failed = 0;

for (const file of files) {
  const c = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenCase;
  const { ok } = runGoldenCase(c);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${c.name} (casos de engine ${c.engineVersion})`);
}

console.log(`\nMotor ${ENGINE_VERSION}: ${files.length - failed} de ${files.length} casos coinciden.`);
process.exit(failed ? 1 : 0);
