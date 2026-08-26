import { asPublicMessage, buildConversationMap, type PublicMessage } from '../../lib/conversation-signal';

const TECHNOCORE_ORIGIN = 'https://technocore.chat';
const ROOM_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const DID_IN_NOTE = /did:key:z[1-9A-HJ-NP-Za-km-z]+/;
const PRODUCTIVITY_CANDIDATE_LIMIT = 12;
const PRODUCTIVITY_DISCOVERY_LIMIT = 48;
const PRODUCTIVITY_MESSAGE_LIMIT = 50;
const PRODUCTIVITY_CACHE_SECONDS = 30;
const TECHNOCORE_TIMEOUT_MS = 8000;

type DidAudit = {
  did: string;
  fingerprint: string;
  expectedPath: string;
  source: 'sharded' | 'legacy' | null;
  note: string | null;
  foundDid: string | null;
  status: 'match' | 'mismatch' | 'missing' | 'invalid';
};

type RoomCandidate = {
  room: string;
  idleSeconds: number | null;
  windowSize: number;
};

type ProductivitySnapshot = Awaited<ReturnType<typeof scanProductiveRooms>>;

let cachedProductivity: { expiresAt: number; snapshot: ProductivitySnapshot } | null = null;
let pendingProductivityScan: Promise<ProductivitySnapshot> | null = null;

async function technocore(path: string) {
  return fetch(`${TECHNOCORE_ORIGIN}${path}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain;q=0.9' },
    signal: AbortSignal.timeout(TECHNOCORE_TIMEOUT_MS),
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

function asRoomCandidate(value: unknown): RoomCandidate | null {
  if (!value || typeof value !== 'object') return null;

  const room = value as Record<string, unknown>;
  if (typeof room.room !== 'string' || !ROOM_NAME.test(room.room)) return null;

  return {
    room: room.room,
    idleSeconds: typeof room.idle_seconds === 'number' && Number.isFinite(room.idle_seconds)
      ? room.idle_seconds
      : null,
    windowSize: typeof room.window === 'number' && Number.isFinite(room.window) ? room.window : 0,
  };
}

function signalRank(signal: ReturnType<typeof buildConversationMap>['signal']) {
  if (signal.state === 'conversation_observed') return 4;
  if (signal.state === 'mixed') {
    const highRisk = signal.templatePressure !== null && signal.templatePressure >= 0.5
      || (signal.burst && signal.oneShotSenderShare !== null && signal.oneShotSenderShare >= 0.7);
    return highRisk ? 1 : 3;
  }
  if (signal.state === 'no_conversation_evidence') return 2;
  if (signal.state === 'insufficient') return 0;
  return 1;
}

async function scanProductiveRooms() {
  const response = await technocore(`/rooms?format=json&limit=${PRODUCTIVITY_DISCOVERY_LIMIT}`);
  if (!response.ok) throw new Error(`Technocore returned ${response.status} while discovering active rooms.`);

  const payload = await response.json() as { rooms?: unknown };
  const candidates = (Array.isArray(payload.rooms) ? payload.rooms : [])
    .map(asRoomCandidate)
    .filter((room): room is RoomCandidate => room !== null)
    .filter((room) => room.room !== 'events' && !room.room.startsWith('mb-'))
    .filter((room) => room.windowSize >= 8)
    .slice(0, PRODUCTIVITY_CANDIDATE_LIMIT);
  const scanned = await Promise.all(candidates.map(async (room) => {
    try {
      const roomResponse = await technocore(`/r/${encodeURIComponent(room.room)}?format=json&limit=${PRODUCTIVITY_MESSAGE_LIMIT}`);
      if (!roomResponse.ok) return null;

      const roomPayload = await roomResponse.json() as { messages?: unknown };
      const messages = Array.isArray(roomPayload.messages)
        ? roomPayload.messages.map(asPublicMessage).filter((message): message is PublicMessage => message !== null)
        : [];
      const map = buildConversationMap(room.room, messages);

      return {
        room: room.room,
        idleSeconds: room.idleSeconds,
        sample: map.sample,
        signal: map.signal,
      };
    } catch {
      return null;
    }
  }));
  const rooms = scanned
    .filter((room): room is NonNullable<typeof room> => room !== null)
    .sort((left, right) => (
      signalRank(right.signal) - signalRank(left.signal)
      || right.signal.linkedReplies - left.signal.linkedReplies
      || (left.signal.templatePressure ?? 1) - (right.signal.templatePressure ?? 1)
      || (left.idleSeconds ?? Number.POSITIVE_INFINITY) - (right.idleSeconds ?? Number.POSITIVE_INFINITY)
    ));

  return {
    sampledAt: new Date().toISOString(),
    candidateRooms: candidates.length,
    unavailableRooms: candidates.length - rooms.length,
    rooms,
  };
}

async function productiveRooms() {
  if (cachedProductivity && cachedProductivity.expiresAt > Date.now()) {
    return cachedProductivity.snapshot;
  }

  if (!pendingProductivityScan) {
    pendingProductivityScan = scanProductiveRooms()
      .then((snapshot) => {
        cachedProductivity = {
          snapshot,
          expiresAt: Date.now() + PRODUCTIVITY_CACHE_SECONDS * 1000,
        };
        return snapshot;
      })
      .finally(() => {
        pendingProductivityScan = null;
      });
  }

  return pendingProductivityScan;
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

    if (resource === 'productive-rooms') {
      return Response.json(await productiveRooms(), {
        headers: { 'Cache-Control': `public, max-age=${PRODUCTIVITY_CACHE_SECONDS}, s-maxage=${PRODUCTIVITY_CACHE_SECONDS}` },
      });
    }

    if (resource === 'room') {
      const room = searchParams.get('room')?.trim() ?? '';
      if (!ROOM_NAME.test(room)) return error('Room names use lowercase letters, numbers, hyphens, and underscores only.');

      const response = await technocore(`/r/${encodeURIComponent(room)}?format=json&limit=8`);
      if (response.status === 404) return error('That public room was not found.', 404);
      if (!response.ok) return error(`Technocore returned ${response.status} while loading this room.`, 502);
      return Response.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (resource === 'conversation') {
      const room = searchParams.get('room')?.trim() ?? '';
      if (!ROOM_NAME.test(room)) return error('Room names use lowercase letters, numbers, hyphens, and underscores only.');

      const response = await technocore(`/r/${encodeURIComponent(room)}?format=json&limit=200`);
      if (response.status === 404) return error('That public room was not found.', 404);
      if (!response.ok) return error(`Technocore returned ${response.status} while loading this room.`, 502);

      const payload = await response.json() as { messages?: unknown };
      const messages = Array.isArray(payload.messages)
        ? payload.messages.map(asPublicMessage).filter((message): message is PublicMessage => message !== null)
        : [];

      return Response.json(buildConversationMap(room, messages), { headers: { 'Cache-Control': 'no-store' } });
    }

    if (resource === 'did') {
      const did = searchParams.get('did')?.trim() ?? '';
      if (!did) return error('A public did:key is required.');
      return Response.json(await auditDid(did), { headers: { 'Cache-Control': 'no-store' } });
    }

    return error('Choose rooms, productive-rooms, room, conversation, or did.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Technocore is temporarily unavailable.';
    return error(message, 502);
  }
}
