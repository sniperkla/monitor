/**
 * Test double for @/utils/supporter.
 *
 * The real module imports mongoose models at load time, which has no business
 * being in a pairing-logic unit test. `state` lets a test flip the gate.
 */
export const state = { isSupporter: true };

export async function getSupporterStatus() {
  return { isSupporter: state.isSupporter, expiresAt: null, isAdmin: false };
}

export function supporterRequiredResponse(feature = 'relay') {
  return { __supporterRequired: true, feature };
}

export function invalidateSupporter() {}
