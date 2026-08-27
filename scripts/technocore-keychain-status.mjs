import { DID, readSigningKey } from './technocore-signing.mjs';

readSigningKey();
console.log(`Technocore signing key is available and matches ${DID}.`);
