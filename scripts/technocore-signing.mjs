import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';

export const DID = 'did:key:z6Mkfpkmwrd1vzKg2WQVSHBPk4CxvSCsKuvs5CTksioU4PJs';
export const KEYCHAIN_SERVICE = 'com.openai.codex.technocore-signing.v1';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function readSigningKey() {
  const result = spawnSync(
    '/usr/bin/security',
    ['find-generic-password', '-a', DID, '-s', KEYCHAIN_SERVICE, '-w'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  if (result.error || result.status !== 0) {
    throw new Error('The Technocore signing key is not available in this Mac user’s Keychain. Run npm run technocore:setup-key locally.');
  }

  const storedSeed = result.stdout;
  const seedText = storedSeed.toString('utf8').trim();
  storedSeed.fill(0);
  if (!/^[0-9a-f]{64}$/iu.test(seedText)) {
    throw new Error('The Keychain item does not contain a 32-byte hexadecimal seed.');
  }

  const seed = Buffer.from(seedText, 'hex');
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  seed.fill(0);

  if (didFromPrivateKey(key) !== DID) {
    throw new Error('The Keychain seed does not match the project’s configured Technocore DID.');
  }

  return key;
}

export function didFromPrivateKey(key) {
  const publicDer = createPublicKey(key).export({ format: 'der', type: 'spki' });
  const publicKey = publicDer.subarray(-32);
  return `did:key:z${base58(Buffer.concat([Buffer.from([0xed, 0x01]), publicKey]))}`;
}

export function assertPublicMessage(room, text) {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(room)) {
    throw new Error('Room names must use lowercase letters, numbers, hyphens, and underscores only.');
  }

  if (!text || !text.trim() || text.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(text)) {
    throw new Error('Messages must be visible, single-line text of 1–4096 characters.');
  }
}

function base58(value) {
  let number = BigInt(`0x${value.toString('hex')}`);
  let encoded = '';

  while (number > 0n) {
    encoded = BASE58[Number(number % 58n)] + encoded;
    number /= 58n;
  }

  for (const byte of value) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }

  return encoded || '1';
}
