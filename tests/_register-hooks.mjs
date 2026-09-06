import * as module from 'node:module';

/**
 * Register the `@/` alias resolver for `node --test`.
 *
 * module.registerHooks() is synchronous and current; module.register() is the
 * deprecated async form. Prefer the new one when the runtime has it.
 */
if (typeof module.registerHooks === 'function') {
  const hooks = await import('./_relay-alias-hooks.mjs');
  module.registerHooks({
    resolve: hooks.resolve,
  });
} else {
  module.register('./_relay-alias-hooks.mjs', import.meta.url);
}
