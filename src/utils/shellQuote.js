/**
 * Shell quoting for SSH/exec commands.
 *
 * Every user-supplied string that is interpolated into a shell command MUST be
 * passed through one of these functions. They produce a safely-quoted shell
 * token that cannot break out of its context.
 *
 * Use `shellQuote(str)` for single-quoted contexts (POSIX sh):
 *   shellQuote("foo'bar")  →  'foo'\''bar'
 *
 * Use `shellQuoteDouble(str)` for a literal double-quoted shell token:
 *   shellQuoteDouble('$HOME')  →  "\$HOME"
 * Use `shellQuoteExpandHome(str)` when a user path may intentionally contain
 * the literal `$HOME` or `~` prefix and that expansion must be preserved.
 *
 * `shellArg(str)` is a convenience for validating that a string is a safe
 * bare argument (alphanumeric, dashes, underscores, dots, slashes) and
 * rejecting anything else — useful for things like PIDs, session names, etc.
 */

const SHELL_SAFE_BARE = /^[a-zA-Z0-9._\-\/]+$/;

/**
 * Single-quote a string for POSIX sh. This is the safest quoting method
 * because single quotes prevent ALL interpretation (no $ expansion, no
 * backticks, no escapes). The only character that needs handling is the
 * single quote itself, escaped as '\''.
 *
 * Example: shellQuote("foo; rm -rf /") → "'foo; rm -rf /'"
 *          shellQuote("foo'bar")       → "'foo'\\''bar'"
 */
export function shellQuote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

/**
 * Double-quote a string for POSIX sh, escaping all shell metacharacters
 * that could break out ($ ` " \ !). Use this ONLY when you need variable
 * expansion inside the quoted string (e.g. "$HOME/path").
 *
 * Example: shellQuoteDouble('$HOME') → '"$HOME"'  (variable IS expanded)
 *          shellQuoteDouble('foo"; rm') → '"foo\\"; rm"'
 */
export function shellQuoteDouble(str) {
  return `"${String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!')}"`;
}

/**
 * Quote a path while preserving only the conventional leading $HOME/~
 * expansion. All other shell metacharacters are treated literally.
 */
export function shellQuoteExpandHome(str) {
  const value = String(str);
  const prefix = value.startsWith('$HOME/') ? '$HOME/' : value.startsWith('~/') ? '~/' : '';
  const rest = prefix ? value.slice(prefix === '$HOME/' ? 6 : 2) : value;
  if (!prefix) return shellQuote(value);
  return `${prefix}${shellQuote(rest)}`;
}

/**
 * Validate that a string is a safe bare shell argument (no quoting needed).
 * If it contains anything outside [a-zA-Z0-9._-/], return null to reject.
 *
 * Useful for: PIDs, tmux session names, file sizes, exit codes.
 */
export function shellArg(str) {
  const s = String(str);
  if (SHELL_SAFE_BARE.test(s)) return s;
  return null;
}

/**
 * Validate and return a safe integer string, or null.
 */
export function shellInt(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return null;
  return String(n);
}
