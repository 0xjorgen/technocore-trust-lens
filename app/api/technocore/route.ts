import { asPublicMessage, buildConversationMap, type ConversationMap, type PublicMessage } from '../../lib/conversation-signal';

const TECHNOCORE_ORIGIN = 'https://technocore.chat';
const ROOM_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DISCOVERY_LIMIT = 64;
const CANDIDATE_LIMIT = 16;
const MESSAGE_LIMIT = 80;
const CACHE_SECONDS = 30;
const TIMEOUT_MS = 8000;

type RoomCandidate = {
  room: string;
  idleSeconds: number | null;
  windowSize: number;
};

type JoinAssessment = {
  room: string;
  score: number;
  recommendation: string;
  summary: string;
  sampledAt: string;
  idleSeconds: number | null;
  sample: ConversationMap['sample'];
  signal: ConversationMap['signal'];
  themes: ConversationMap['terms'];
  factors: Array<{
    label: string;
    value: number;
    max: number;
    detail: string;
  }>;
};

type Rankings = {
  sampledAt: string;
  candidateRooms: number;
  unavailableRooms: number;
  heuristicVersion: string;
  themes: Array<{ term: string; rooms: number }>;
  rooms: JoinAssessment[];
};

let cachedRankings: { expiresAt: number; snapshot: Rankings } | null = null;
let pendingRankings: Promise<Rankings> | null = null;

async function technocore(path: string) {
  return fetch(TECHNOCORE_ORIGIN + path, {
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
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

function roomAssessment(room: string, idleSeconds: number | null, messages: PublicMessage[]): JoinAssessment {
  const map = buildConversationMap(room, messages);
  const distinctParticipants = new Set(messages.map((message) => message.from)).size;
  const publicPointers = messages.filter((message) => /https?:\/\/\S+/u.test(message.text)).length;
  const continuity = Math.min(35, map.signal.linkedReplies * 10 + map.signal.linkedQuestionResponses * 5);
  const pointers = Math.min(20, publicPointers * 5);
  const participation = Math.min(15, distinctParticipants * 3);
  const freshness = idleSeconds === null ? 7 : idleSeconds < 300 ? 15 : idleSeconds < 3600 ? 10 : idleSeconds < 86400 ? 5 : 1;
  const patternClarity = map.signal.templatePressure === null
    ? 7
    : Math.round((1 - map.signal.templatePressure) * 15);
  const score = continuity + pointers + participation + freshness + patternClarity;
  const recommendation = score >= 70
    ? 'Strong room to explore'
    : score >= 45
      ? 'Worth a closer look'
      : score >= 25
        ? 'Browse before joining'
        : 'Wait for clearer signal';

  return {
    room,
    score,
    recommendation,
    summary: score >= 45
      ? 'Recent activity shows enough visible follow-through to inspect the room with intent.'
      : 'The sampled activity does not yet show enough transparent follow-through for a confident join decision.',
    sampledAt: map.sampledAt,
    idleSeconds,
    sample: map.sample,
    signal: map.signal,
    themes: map.terms.slice(0, 6),
    factors: [
      {
        label: 'Conversation continuity',
        value: continuity,
        max: 35,
        detail: 'Explicit cross-participant references and responses to questions in the sampled window.',
      },
      {
        label: 'Public pointers',
        value: pointers,
        max: 20,
        detail: 'Messages containing public URLs. These are pointers to inspect, not proof of quality.',
      },
      {
        label: 'Participation context',
        value: participation,
        max: 15,
        detail: 'Distinct senders in the sample. This is context, never an identity or credibility judgment.',
      },
      {
        label: 'Freshness',
        value: freshness,
        max: 15,
        detail: 'How recently the room reported activity.',
      },
      {
        label: 'Pattern clarity',
        value: patternClarity,
        max: 15,
        detail: 'Lower recurring-template pressure leaves more room to inspect the discussion itself.',
      },
    ],
  };
}

async function inspectRoom(room: string, idleSeconds: number | null) {
  const response = await technocore('/r/' + encodeURIComponent(room) + '?format=json&limit=' + MESSAGE_LIMIT);
  if (response.status === 404) throw new Error('That public room was not found.');
  if (!response.ok) throw new Error('Technocore returned ' + response.status + ' while reading this room.');

  const payload = await response.json() as { messages?: unknown };
  const messages = Array.isArray(payload.messages)
    ? payload.messages.map(asPublicMessage).filter((message): message is PublicMessage => message !== null)
    : [];

  return roomAssessment(room, idleSeconds, messages);
}

async function scanRankings(): Promise<Rankings> {
  const response = await technocore('/rooms?format=json&limit=' + DISCOVERY_LIMIT);
  if (!response.ok) throw new Error('Technocore returned ' + response.status + ' while discovering rooms.');

  const payload = await response.json() as { rooms?: unknown };
  const candidates = (Array.isArray(payload.rooms) ? payload.rooms : [])
    .map(asRoomCandidate)
    .filter((room): room is RoomCandidate => room !== null)
    .filter((room) => room.room !== 'events' && !room.room.startsWith('mb-'))
    .filter((room) => room.windowSize >= 8)
    .slice(0, CANDIDATE_LIMIT);
  const inspected = await Promise.all(candidates.map(async (room) => {
    try {
      return await inspectRoom(room.room, room.idleSeconds);
    } catch {
      return null;
    }
  }));
  const rooms = inspected
    .filter((room): room is JoinAssessment => room !== null)
    .sort((left, right) => right.score - left.score || (left.idleSeconds ?? Infinity) - (right.idleSeconds ?? Infinity));
  const themeRooms = new Map<string, number>();
  for (const room of rooms) {
    for (const term of new Set(room.themes.map((theme) => theme.term))) {
      themeRooms.set(term, (themeRooms.get(term) ?? 0) + 1);
    }
  }
  const themes = [...themeRooms.entries()]
    .filter(([, roomCount]) => roomCount >= 2)
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
    .slice(0, 8)
    .map(([term, rooms]) => ({ term, rooms }));

  return {
    sampledAt: new Date().toISOString(),
    candidateRooms: candidates.length,
    unavailableRooms: candidates.length - rooms.length,
    heuristicVersion: '0.1',
    themes,
    rooms,
  };
}

async function rankings() {
  if (cachedRankings && cachedRankings.expiresAt > Date.now()) return cachedRankings.snapshot;

  if (!pendingRankings) {
    pendingRankings = scanRankings()
      .then((snapshot) => {
        cachedRankings = { snapshot, expiresAt: Date.now() + CACHE_SECONDS * 1000 };
        return snapshot;
      })
      .finally(() => {
        pendingRankings = null;
      });
  }

  return pendingRankings;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  try {
    if (resource === 'rankings') {
      return Response.json(await rankings(), {
        headers: { 'Cache-Control': 'public, max-age=' + CACHE_SECONDS + ', s-maxage=' + CACHE_SECONDS },
      });
    }

    if (resource === 'room') {
      const room = searchParams.get('room')?.trim() ?? '';
      if (!ROOM_NAME.test(room)) return error('Room names use lowercase letters, numbers, hyphens, and underscores only.');
      return Response.json(await inspectRoom(room, null), { headers: { 'Cache-Control': 'no-store' } });
    }

    return error('Choose rankings or room.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Technocore is temporarily unavailable.';
    return error(message, 502);
  }
}
