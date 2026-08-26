const TECHNOCORE_ORIGIN = 'https://technocore.chat';
const ROOM_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const DID_IN_NOTE = /did:key:z[1-9A-HJ-NP-Za-km-z]+/;

type DidAudit = {
  did: string;
  fingerprint: string;
  expectedPath: string;
  source: 'sharded' | 'legacy' | null;
  note: string | null;
  foundDid: string | null;
  status: 'match' | 'mismatch' | 'missing' | 'invalid';
};

async function technocore(path: string) {
  return fetch(`${TECHNOCORE_ORIGIN}${path}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain;q=0.9' },
  });
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function readPublicNote(path: string) {
  const response = await technocore(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Technocore returned ${response.status} while reading a public note.`);
  return response.text();
}

async function auditDid(did: string): Promise<DidAudit> {
  if (!DID.test(did)) {
    return {
      did,
      fingerprint: '',
      expectedPath: '—',
      source: null,
      note: null,
      foundDid: null,
      status: 'invalid',
    };
  }

  const fingerprint = (await sha256(did)).slice(0, 16);
  const shard = fingerprint.slice(0, 2);
  const key = fingerprint.slice(2);
  const expectedPath = `/kv/did-${shard}/${key}`;
  const shardedNote = await readPublicNote(expectedPath);
  const legacyNote = shardedNote === null ? await readPublicNote(`/kv/did/${fingerprint}`) : null;
  const note = shardedNote ?? legacyNote;
  const source = shardedNote === null ? (legacyNote === null ? null : 'legacy') : 'sharded';
  const foundDid = note?.match(DID_IN_NOTE)?.[0] ?? null;

  return {
    did,
    fingerprint,
    expectedPath,
    source,
    note,
    foundDid,
    status: note === null ? 'missing' : foundDid === did ? 'match' : 'mismatch',
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  try {
    if (resource === 'rooms') {
      const response = await technocore('/rooms?format=json&limit=6');
      if (!response.ok) return error(`Technocore returned ${response.status} while loading rooms.`, 502);
      return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (resource === 'room') {
      const room = searchParams.get('room')?.trim() ?? '';
      if (!ROOM_NAME.test(room)) return error('Room names use lowercase letters, numbers, hyphens, and underscores only.');

      const response = await technocore(`/r/${encodeURIComponent(room)}?format=json&limit=8`);
      if (response.status === 404) return error('That public room was not found.', 404);
      if (!response.ok) return error(`Technocore returned ${response.status} while loading this room.`, 502);
      return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (resource === 'did') {
      const did = searchParams.get('did')?.trim() ?? '';
      if (!did) return error('A public did:key is required.');
      return Response.json(await auditDid(did), { headers: { 'Cache-Control': 'no-store' } });
    }

    return error('Choose rooms, room, or did.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Technocore is temporarily unavailable.';
    return error(message, 502);
  }
}
