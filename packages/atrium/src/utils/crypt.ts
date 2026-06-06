/**
 * Symmetric authenticated encryption for the Firm Memory disaster-recovery
 * mirror.
 *
 * Cipher: AES-256-GCM (96-bit IV, 128-bit auth tag) per NIST SP 800-38D.
 * KDF:    PBKDF2-HMAC-SHA-512, 600_000 iterations, 256-bit derived key,
 *         128-bit random salt — matches the Bonita G vault Meld Encrypt
 *         convention used in their existing release per the founder's
 *         standards. Keeps zero-dep (node:crypto only).
 *
 * On-disk file layout produced by `sync drive push` is:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ "BTSTFMv1"      8 bytes  (magic; cleartext)  │
 *   │ salt           16 bytes                      │
 *   │ iv             12 bytes                      │
 *   │ tag            16 bytes                      │
 *   │ ciphertext     N  bytes                      │
 *   └──────────────────────────────────────────────┘
 *
 * The magic header is intentionally OUTSIDE the encrypted region: it lets
 * `sync drive status` cheaply detect "is this our bundle?" by reading the
 * first 8 bytes of an object listing without download. Salt/iv/tag are
 * also cleartext as is standard for AES-GCM — only the bundle body is
 * confidential.
 *
 * Tamper detection: GCM's auth tag binds the entire ciphertext + IV; any
 * single-byte modification of the ciphertext (or of the tag itself) will
 * cause `decipher.final()` to throw — see `crypt.test.ts`.
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

export const BUNDLE_MAGIC = Buffer.from('BTSTFMv1', 'utf8');
export const SALT_BYTES = 16;
export const IV_BYTES = 12; // 96 bits — recommended GCM IV width
export const TAG_BYTES = 16;
export const KEY_BYTES = 32; // AES-256
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_DIGEST = 'sha512';

export interface EncryptedBundle {
  ciphertext: Buffer;
  iv: Buffer;
  salt: Buffer;
  tag: Buffer;
}

export interface DecryptInput extends EncryptedBundle {
  passphrase: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length === 0) {
    throw new Error('Passphrase is empty — refusing to derive key.');
  }
  return pbkdf2Sync(
    Buffer.from(passphrase, 'utf8'),
    salt,
    PBKDF2_ITERATIONS,
    KEY_BYTES,
    PBKDF2_DIGEST,
  );
}

/**
 * Encrypt an arbitrary plaintext buffer with AES-256-GCM. Generates fresh
 * random salt + IV every call (never reuse — GCM IV reuse is catastrophic).
 */
export function encryptBundle(plaintext: Buffer, passphrase: string): EncryptedBundle {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext, iv, salt, tag };
}

/**
 * Decrypt a bundle produced by `encryptBundle`. Throws if the auth tag
 * fails (passphrase wrong, ciphertext tampered, or salt/iv mismatched).
 */
export function decryptBundle(input: DecryptInput): Buffer {
  const { ciphertext, iv, salt, tag, passphrase } = input;
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}, got ${iv.length}.`);
  }
  if (salt.length !== SALT_BYTES) {
    throw new Error(`Invalid salt length: expected ${SALT_BYTES}, got ${salt.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid tag length: expected ${TAG_BYTES}, got ${tag.length}.`);
  }
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Serialize an encrypted bundle into the on-disk format documented at the
 * top of this file. Concatenates `magic || salt || iv || tag || ciphertext`.
 */
export function packEncrypted(bundle: EncryptedBundle): Buffer {
  return Buffer.concat([BUNDLE_MAGIC, bundle.salt, bundle.iv, bundle.tag, bundle.ciphertext]);
}

/**
 * Inverse of `packEncrypted`. Validates the magic header before slicing.
 */
export function unpackEncrypted(buf: Buffer): EncryptedBundle {
  if (buf.length < BUNDLE_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted bundle is too small to contain the header.');
  }
  const magic = buf.subarray(0, BUNDLE_MAGIC.length);
  if (!magic.equals(BUNDLE_MAGIC)) {
    throw new Error(
      `Bad magic header: expected ${BUNDLE_MAGIC.toString('utf8')}, got ${magic.toString('utf8')}.`,
    );
  }
  let offset = BUNDLE_MAGIC.length;
  const salt = buf.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = buf.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = buf.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const ciphertext = buf.subarray(offset);
  return { ciphertext, iv, salt, tag };
}

/**
 * Cheap "is this one of ours?" probe — peeks at the first 8 bytes only.
 * Used by `sync drive status` to flag bundles in the Drive folder that
 * weren't produced by this CLI (e.g., manual uploads, foreign tools).
 */
export function looksLikeBatisteBundle(firstEightBytes: Buffer): boolean {
  return firstEightBytes.length >= BUNDLE_MAGIC.length
    && firstEightBytes.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC);
}
