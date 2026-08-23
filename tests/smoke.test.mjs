import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('package.json is valid and has required scripts', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const s of ['dev', 'build', 'start', 'lint', 'test']) {
    assert.ok(pkg.scripts[s], `missing script: ${s}`);
  }
});

test('key entry files exist', () => {
  for (const f of ['server.js', 'next.config.mjs', 'src/app/layout.js', 'src/lib/logger.js']) {
    assert.ok(existsSync(f), `missing file: ${f}`);
  }
});

test('logger module source defines all levels', () => {
  const src = readFileSync('src/lib/logger.js', 'utf8');
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.ok(src.includes(`${level}(...args)`), `logger missing ${level}()`);
  }
});
