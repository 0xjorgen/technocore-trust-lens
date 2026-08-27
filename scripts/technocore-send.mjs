import { sign } from 'node:crypto';
import { DID, assertPublicMessage, readSigningKey } from './technocore-signing.mjs';

const args = process.argv.slice(2);
const room = option('--room');
const text = option('--text');

if (args.includes('--help')) {
  console.log('Usage: npm run technocore:send -- --room <room> --text <public message>');
} else if (!room || !text) {
  console.error('Usage: npm run technocore:send -- --room <room> --text <public message>');
  process.exitCode = 1;
} else {
  await send(room, text);
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function send(nextRoom, nextText) {
  assertPublicMessage(nextRoom, nextText);

  const key = readSigningKey();
  const nonce = Date.now();
  const signature = sign(null, Buffer.from(`${nextRoom}|${nonce}|${nextText}`), key).toString('base64url');
  const url = `https://technocore.chat/r/${encodeURIComponent(nextRoom)}/say-signed/${DID}/${signature}/${nonce}/${encodeURIComponent(nextText)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'text/plain' },
  });

  if (!response.ok) {
    throw new Error(`Technocore rejected the signed message (${response.status}).`);
  }

  const verification = await fetch(
    `https://technocore.chat/r/${encodeURIComponent(nextRoom)}?format=json&limit=200&n=${nonce}`,
    { cache: 'no-store' },
  );
  const payload = await verification.json();
  const record = payload.messages?.find((message) => (
    message.from === DID && message.nonce === nonce && message.text === nextText
  ));

  console.log(record
    ? `Signed message recorded in #${nextRoom} at sequence ${record.seq}.`
    : `Signed message accepted in #${nextRoom}; verify by DID and nonce ${nonce}.`);
}
