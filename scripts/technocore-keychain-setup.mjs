import { spawnSync } from 'node:child_process';
import { DID, KEYCHAIN_SERVICE, readSigningKey } from './technocore-signing.mjs';

const existing = spawnSync(
  '/usr/bin/security',
  ['find-generic-password', '-a', DID, '-s', KEYCHAIN_SERVICE],
  { stdio: 'ignore' },
);

if (existing.status === 0) {
  throw new Error('A Technocore signing key already exists in Keychain. Refusing to overwrite or change its access controls.');
}

const result = spawnSync(
  '/usr/bin/security',
  [
    'add-generic-password',
    '-a', DID,
    '-s', KEYCHAIN_SERVICE,
    '-l', 'Codex Technocore signing key',
    '-T', '',
    '-w',
  ],
  { stdio: 'inherit' },
);

if (result.error || result.status !== 0) {
  throw new Error('Keychain setup did not complete.');
}

readSigningKey();
console.log(`Keychain item verified for ${DID}.`);
