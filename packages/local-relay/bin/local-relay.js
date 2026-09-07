#!/usr/bin/env node
'use strict';

/**
 * ssh-monitor-relay — command line entry point.
 *
 * This file is intentionally three lines of logic. Every decision the relay
 * makes lives in ../dist/local-relay.js, which is copied verbatim from the
 * built artifact public/local-relay.min.js at pack time (scripts/prepack.mjs)
 * — the same bytes the server serves at GET /local-relay.js, so npm users and
 * curl users run identical code.
 *
 * dist/local-relay.js is a build, not readable source. That is deliberate; see
 * the LICENSE. Keeping this wrapper thin still matters for the same reason:
 * there is no second place where behaviour could hide.
 */

require('../dist/local-relay.js');
