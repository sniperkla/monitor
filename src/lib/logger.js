/**
 * Leveled logger for server-side code (API routes, lib, jobs).
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('job started', { jobId });
 *   logger.error('failed', err);
 *
 * Control verbosity with LOG_LEVEL=debug|info|warn|error|silent (default: info).
 * Optional namespace prefix via LOG_SCOPE or logger.child('scope').
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

class Logger {
  constructor(scope) {
    this.scope = scope || '';
  }

  _emit(level, write, args) {
    if ((LEVELS[level] ?? LEVELS.info) < currentLevel()) return;
    const ts = new Date().toISOString();
    const prefix = this.scope ? `${ts} [${this.scope}]` : ts;
    write(prefix, ...args);
  }

  debug(...args) {
    this._emit('debug', console.log, args);
  }

  info(...args) {
    this._emit('info', console.log, args);
  }

  warn(...args) {
    this._emit('warn', console.warn, args);
  }

  error(...args) {
    this._emit('error', console.error, args);
  }

  /** Returns a namespaced child logger, e.g. logger.child('deploy'). */
  child(scope) {
    return new Logger(this.scope ? `${this.scope}:${scope}` : scope);
  }
}

export const logger = new Logger(process.env.LOG_SCOPE || '');
export default logger;