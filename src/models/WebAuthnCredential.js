import mongoose from 'mongoose';

/**
 * Registered passkeys / WebAuthn authenticators.
 *
 * Why passkeys are worth the extra moving parts
 * ---------------------------------------------
 * A password is a shared secret: the user types it into whatever page is in
 * front of them, and the server stores a verifier for it. That makes it
 * phishable (type it into the wrong page), replayable (reuse it everywhere),
 * and dumpable (breach one site, attack every other).
 *
 * A passkey inverts this. The private key never leaves the authenticator, and
 * the signature it produces is bound to the *origin* the browser is actually
 * on. A credential registered for monitor.example.com simply cannot be used to
 * sign a challenge served from monitor-example.com. Phishing sites get nothing
 * because the browser will not even offer the credential on the wrong origin.
 *
 * What is stored here is public data only: the credential id and the public
 * key. There is no secret in this collection that would let anyone impersonate
 * the user.
 */
const WebAuthnCredentialSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },

  /** Base64URL credential id — the handle the browser presents at login. */
  credentialId: { type: String, required: true, unique: true },

  /** COSE-encoded public key, Base64URL. Public by design. */
  publicKey: { type: String, required: true },

  /**
   * Signature counter. A decrease (or a non-increasing value on an
   * authenticator that reports counters) indicates a cloned authenticator.
   */
  counter: { type: Number, default: 0 },

  /** How the authenticator talks to the browser (usb, nfc, ble, internal, hybrid). */
  transports: { type: [String], default: [] },

  /** User-supplied label, e.g. "MacBook Touch ID". */
  name: { type: String, default: '' },

  /** Whether the platform backed the credential up (iCloud / Google Password Manager). */
  backedUp: { type: Boolean, default: false },
  deviceType: { type: String, default: '' },

  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
  versionKey: false,
});

WebAuthnCredentialSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.WebAuthnCredential ||
  mongoose.model('WebAuthnCredential', WebAuthnCredentialSchema);
