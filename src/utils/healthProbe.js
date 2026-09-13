/**
 * Interpret an `/api/health` response.
 *
 * The endpoint answers 503 for ANY degraded state, and the database is only one
 * of the clauses behind that:
 *
 *     status = memory.safe && mongoUp ? 'ok' : 'degraded'
 *
 * So a tripped memory guard — or an absent relay — returns 503 with
 * `mongo.up === true`. Classifying on the status code alone reads that as a
 * database outage; classifying on the flag tells the two apart. AppContext and
 * MongoDeadBanner already read the flag. This exists so BootSequence does too,
 * and so the rule can be tested directly instead of by inspecting source.
 *
 * @param {{ ok?: boolean, status?: number }|null} res  the fetch Response (or a stub)
 * @param {object|null} body                            the parsed JSON body
 * @returns {{ ok: boolean, dbDown: boolean, degraded: boolean, httpStatus: number }}
 *   ok       — the server answered AND the database is reachable; the caller may proceed
 *   dbDown   — the database is unreachable; the only case that is fatal
 *   degraded — reachable, but the server reports itself degraded; warn and continue
 */
export function classifyHealth(res, body) {
  const httpStatus = res?.status ?? 0;
  const mongoUp = body?.mongo?.up;

  // The body is authoritative; the status code is not. A 503 with the database
  // up means the box is busy, not broken.
  if (mongoUp === true) {
    return { ok: true, dbDown: false, degraded: !res?.ok, httpStatus };
  }

  if (mongoUp === false) {
    return { ok: false, dbDown: true, degraded: false, httpStatus };
  }

  // 2xx with no parseable body. The endpoint always sends JSON, so this is a
  // proxy/captive-portal artifact. Treat it as reachable, which is what the
  // previous status-code-only check did — this must not become a new failure.
  if (res?.ok) {
    return { ok: true, dbDown: false, degraded: false, httpStatus };
  }

  // No usable body and not a 2xx: a 500 from the route, or a gateway error
  // page. Keep the old classification so the message the user sees is the same.
  return {
    ok: false,
    dbDown: body?.status === 'degraded' || httpStatus === 503,
    degraded: false,
    httpStatus,
  };
}
