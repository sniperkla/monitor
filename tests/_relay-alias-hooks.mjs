import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Resolve `@/` (jsconfig path alias) for `node --test`.
 *
 * package.json has no "type": "module", so Next owns the compilation and every
 * .js file under src/ is ESM in practice but CommonJS to bare node. We force
 * format: 'module' so the imports parse.
 */

const SRC = path.resolve(process.cwd(), 'src');

/** Swap out modules that would otherwise drag mongoose into a unit test. */
const STUBS = new Map([['@/utils/supporter', 'tests/_stubs/supporter.mjs']]);

// Synchronous by design: module.registerHooks() (Node 22.15+) rejects async
// hooks, and nothing here needs to await.
export function resolve(specifier, context, nextResolve) {
  if (STUBS.has(specifier)) {
    return {
      url: pathToFileURL(path.resolve(process.cwd(), STUBS.get(specifier))).href,
      format: 'module',
      shortCircuit: true,
    };
  }
  if (specifier.startsWith('@/')) {
    // Next resolves extensionless imports; bare node does not.
    const base = path.join(SRC, specifier.slice(2));
    const found = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')].find(
      (c) => fs.existsSync(c) && fs.statSync(c).isFile()
    );
    if (found) {
      return { url: pathToFileURL(found).href, format: 'module', shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
