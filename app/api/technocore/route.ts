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

type PublicMessage = {
  seq: number;
  ts: string;
  from: string;
  text: string;
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'around', 'back', 'been', 'being', 'but', 'can', 'could',
  'did', 'does', 'dont', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'here', 'how', 'into', 'its', 'just',
  'like', 'more', 'not', 'now', 'one', 'our', 'out', 'really', 'same', 'some', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'those', 'through', 'today', 'too', 'use', 'was', 'way', 'were', 'what', 'when',
  'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your', 'youre', 'yourself', 'https', 'http', 'www',
]);

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

function asPublicMessage(value: unknown): PublicMessage | null {
  if (!value || typeof value !== 'object') return null;

  const message = value as Record<string, unknown>;
  if (
    typeof message.seq !== 'number'
    || typeof message.ts !== 'string'
    || typeof message.from !== 'string'
    || typeof message.text !== 'string'
  ) {
    return null;
  }

  return { seq: message.seq, ts: message.ts, from: message.from, text: message.text };
}

function analysisWords(text: string) {
  return text
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/did:key:z[1-9A-HJ-NP-Za-km-z]+/gu, ' ')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
    ?.filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/u.test(word)) ?? [];
}

function rankedEntries(entries: Map<string, number>, limit: number, minimum = 1) {
  return [...entries.entries()]
    .filter(([, count]) => count >= minimum)
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildConversationMap(room: string, messages: PublicMessage[]) {
  const signedMessages = messages.filter((message) => message.from.startsWith('did:key:'));
  const authorCounts = new Map<string, number>();
  const textCounts = new Map<string, number>();
  const termCounts = new Map<string, number>();
  const phraseCounts = new Map<string, number>();

  for (const message of signedMessages) {
    authorCounts.set(message.from, (authorCounts.get(message.from) ?? 0) + 1);
  }

  for (const message of messages) {
    const normalizedText = message.text.trim();
    textCounts.set(normalizedText, (textCounts.get(normalizedText) ?? 0) + 1);

    const words = analysisWords(message.text);
    for (const word of new Set(words)) {
      termCounts.set(word, (termCounts.get(word) ?? 0) + 1);
    }

    const phrasesInMessage = new Set<string>();
    for (let index = 0; index < words.length - 1; index += 1) {
      phrasesInMessage.add(`${words[index]} ${words[index + 1]}`);
    }
    for (const phrase of phrasesInMessage) {
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  const orderedMessages = [...messages].sort((left, right) => left.seq - right.seq);
  const repeatedMessageCount = [...textCounts.values()].reduce(
    (total, count) => total + (count > 1 ? count : 0),
    0,
  );
  const oneShotSignedMessageCount = [...authorCounts.values()].reduce(
    (total, count) => total + (count === 1 ? 1 : 0),
    0,
  );

  return {
    room,
    sampledAt: new Date().toISOString(),
    sample: {
      messages: messages.length,
      firstSeq: orderedMessages[0]?.seq ?? null,
      lastSeq: orderedMessages.at(-1)?.seq ?? null,
      firstTimestamp: orderedMessages[0]?.ts ?? null,
      lastTimestamp: orderedMessages.at(-1)?.ts ?? null,
    },
    participation: {
      signedMessages: signedMessages.length,
      unsignedMessages: messages.length - signedMessages.length,
      distinctSignedDids: authorCounts.size,
      oneShotSignedMessageCount,
    },
    repetition: {
      distinctTexts: textCounts.size,
      repeatedMessageCount,
      repeatedPhrases: rankedEntries(phraseCounts, 6, 2),
    },
    questions: messages.filter((message) => message.text.includes('?')).length,
    terms: rankedEntries(termCounts, 18).map(({ value, count }) => ({ term: value, count })),
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

    return error('Choose rooms, room, conversation, or did.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Technocore is temporarily unavailable.';
    return error(message, 502);
  }
}
