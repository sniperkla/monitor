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
  console.log(`Running generator: ${scriptName}`);
  try {
    const result = spawnSync(process.execPath, [fullPath], {
      stdio: 'inherit'
    });

    if (result.error) {
      console.error(`Failed to execute ${scriptName}:`, result.error);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`Generator ${scriptName} failed with exit code ${result.status}`);
      process.exit(result.status || 1);
    }
  } catch (error) {
    console.error(`Failed to execute ${scriptName}:`, error);
    process.exit(1);
  }
}
