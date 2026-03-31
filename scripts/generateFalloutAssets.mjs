import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generators = [
  'generateFalloutNukeGlb.mjs',
  'generateFalloutWorldPropsGlb.mjs',
  'generateFalloutAirstrikeAssetsGlb.mjs',
  'generateFalloutBaseStructuresGlb.mjs',
  'generateFalloutKaijuAssetsGlb.mjs',
  'generateFalloutCommandEffectsGlb.mjs',
  'generateFalloutHumanUnitsGlb.mjs'
];

for (const scriptName of generators) {
  const fullPath = path.join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
