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

test('desktop window content constrains app height for internal scrolling', () => {
  const windowSrc = readFileSync('src/components/Desktop/Window.js', 'utf8');
  const settingsSrc = readFileSync('src/apps/SettingsApp.js', 'utf8');
  const css = readFileSync('src/app/globals.css', 'utf8');

  assert.match(windowSrc, /flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto/,
    'window content must be shrinkable so child apps scroll instead of expanding it');
  assert.match(settingsSrc, /flex h-full min-h-0 w-full/,
    'Settings root must participate in the constrained flex height chain');
  assert.match(settingsSrc, /flex-1 min-h-0 min-w-0 overflow-y-auto/,
    'Settings pane must scroll within the desktop window');
  assert.match(css, /\.window-container > \.title-bar \+ div \{\s*min-width: 0;\s*min-height: 0;/,
    'shared window CSS must preserve the constrained viewport contract');
});

test('logger module source defines all levels', () => {
  const src = readFileSync('src/lib/logger.js', 'utf8');
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.ok(src.includes(`${level}(...args)`), `logger missing ${level}()`);
  }
});
