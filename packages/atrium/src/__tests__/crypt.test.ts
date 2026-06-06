/**
 * Round-trip + tamper tests for utils/crypt.ts.
 *
 * Spec coverage:
 *   - encrypt/decrypt symmetry across multiple plaintext sizes
 *   - empty passphrase is rejected
 *   - GCM auth tag detects ciphertext tampering
 *   - GCM auth tag detects tag tampering
 *   - wrong passphrase fails decrypt
 *   - magic-header pack/unpack symmetry
 *   - looksLikeBatisteBundle correctly classifies first 8 bytes
 */

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_MAGIC,
  decryptBundle,
  encryptBundle,
  looksLikeBatisteBundle,
  packEncrypted,
  unpackEncrypted,
} from '../utils/crypt.js';

const PASS = 'correct horse battery staple';

describe('crypt: encryptBundle / decryptBundle', () => {
  const sizes = [0, 1, 16, 1024, 64 * 1024];
  for (const n of sizes) {
    it(`round-trips ${n}-byte plaintext`, () => {
      const plaintext = n === 0 ? Buffer.alloc(0) : randomBytes(n);
      const enc = encryptBundle(plaintext, PASS);
      expect(enc.iv).toHaveLength(12);
      expect(enc.salt).toHaveLength(16);
      expect(enc.tag).toHaveLength(16);
      // Ciphertext length matches plaintext length for AES-GCM
      // (it is a stream cipher under the hood — no block padding).
      expect(enc.ciphertext).toHaveLength(n);
      const dec = decryptBundle({ ...enc, passphrase: PASS });
      expect(dec.equals(plaintext)).toBe(true);
    });
  }

  it('rejects empty passphrase on encrypt', () => {
    expect(() => encryptBundle(Buffer.from('hi'), '')).toThrow(/empty/i);
  });

  it('rejects empty passphrase on decrypt', () => {
    const enc = encryptBundle(Buffer.from('hi'), PASS);
    expect(() => decryptBundle({ ...enc, passphrase: '' })).toThrow(/empty/i);
  });

  it('decrypt fails when ciphertext is tampered', () => {
    const enc = encryptBundle(randomBytes(256), PASS);
    const tampered = Buffer.from(enc.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() => decryptBundle({ ...enc, ciphertext: tampered, passphrase: PASS })).toThrow();
  });

  it('decrypt fails when auth tag is tampered', () => {
    const enc = encryptBundle(randomBytes(64), PASS);
    const badTag = Buffer.from(enc.tag);
    badTag[0] = (badTag[0] ?? 0) ^ 0xff;
    expect(() => decryptBundle({ ...enc, tag: badTag, passphrase: PASS })).toThrow();
  });

  it('decrypt fails with the wrong passphrase', () => {
    const enc = encryptBundle(randomBytes(128), PASS);
    expect(() => decryptBundle({ ...enc, passphrase: 'wrong-passphrase' })).toThrow();
  });

  it('produces a different ciphertext each call (fresh salt + IV)', () => {
    const plaintext = randomBytes(32);
    const a = encryptBundle(plaintext, PASS);
    const b = encryptBundle(plaintext, PASS);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.salt.equals(b.salt)).toBe(false);
  });
});

describe('crypt: pack/unpack on-disk format', () => {
  it('packEncrypted then unpackEncrypted returns the original parts', () => {
    const enc = encryptBundle(randomBytes(2048), PASS);
    const packed = packEncrypted(enc);
    expect(packed.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)).toBe(true);
    const back = unpackEncrypted(packed);
    expect(back.salt.equals(enc.salt)).toBe(true);
    expect(back.iv.equals(enc.iv)).toBe(true);
    expect(back.tag.equals(enc.tag)).toBe(true);
    expect(back.ciphertext.equals(enc.ciphertext)).toBe(true);
    const dec = decryptBundle({ ...back, passphrase: PASS });
    expect(dec).toHaveLength(2048);
  });

  it('unpackEncrypted rejects non-magic input', () => {
    const garbage = Buffer.concat([Buffer.from('NOTOURSX'), randomBytes(100)]);
    expect(() => unpackEncrypted(garbage)).toThrow(/magic/i);
  });

  it('unpackEncrypted rejects truncated input', () => {
    const tiny = Buffer.from('BTSTFMv1');
    expect(() => unpackEncrypted(tiny)).toThrow(/too small/i);
  });

  it('looksLikeBatisteBundle detects the magic header', () => {
    expect(looksLikeBatisteBundle(BUNDLE_MAGIC)).toBe(true);
    expect(looksLikeBatisteBundle(Buffer.from('NOTOURSX'))).toBe(false);
    expect(looksLikeBatisteBundle(Buffer.from('BTST'))).toBe(false); // too short
  });
});
