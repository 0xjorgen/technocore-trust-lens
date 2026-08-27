export type PublicMessage = {
  seq: number;
  ts: string;
  from: string;
  text: string;
};

export type ConversationSignalState =
  | 'conversation_observed'
  | 'mixed'
  | 'template_heavy'
  | 'high_churn'
  | 'no_conversation_evidence'
  | 'insufficient';

export type ConversationSignal = {
  state: ConversationSignalState;
  label: string;
  summary: string;
  linkedReplies: number;
  linkedParticipants: number;
  linkedQuestionResponses: number;
  templatePressure: number | null;
  oneShotSenderShare: number | null;
  messagesPerMinute: number | null;
  burst: boolean;
};

export type ConversationMap = {
  room: string;
  sampledAt: string;
  sample: {
    messages: number;
    firstSeq: number | null;
    lastSeq: number | null;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  participation: {
    signedMessages: number;
    unsignedMessages: number;
    distinctSignedDids: number;
    oneShotSignedMessageCount: number;
  };
  repetition: {
    distinctTexts: number;
    repeatedMessageCount: number;
    repeatedPhrases: Array<{ value: string; count: number }>;
  };
  questions: number;
  terms: Array<{ term: string; count: number }>;
  signal: ConversationSignal;
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'around', 'back', 'been', 'being', 'but', 'can', 'could',
  'did', 'does', 'dont', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'here', 'how', 'into', 'its', 'just',
  'like', 'more', 'not', 'now', 'one', 'our', 'out', 'really', 'same', 'some', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'those', 'through', 'today', 'too', 'use', 'was', 'way', 'were', 'what', 'when',
  'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your', 'youre', 'yourself', 'https', 'http', 'www',
]);

const URL = /https?:\/\/\S+/giu;
const DID = /did:key:z[1-9A-HJ-NP-Za-km-z]+/gu;
const LONG_IDENTIFIER = /\b(?:0x)?[0-9a-f]{8,}\b/giu;
const NUMBER = /\b\d+(?:[._:-]\d+)*\b/gu;
const REFERENCE = /\b(?:re|reply(?:ing)?\s+to)\s*#?\s*(\d+)\b/giu;
const LEADING_REFERENCE = /^\s*(\d+)\s*:/u;

export function asPublicMessage(value: unknown): PublicMessage | null {
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
    .replace(URL, ' ')
    .replace(DID, ' ')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
    ?.filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/u.test(word)) ?? [];
}

function templateWords(text: string) {
  return text
    .replace(URL, ' ')
    .replace(DID, ' ')
    .replace(LONG_IDENTIFIER, ' identifier ')
    .replace(NUMBER, ' number ')
    .toLocaleLowerCase()
    .match(/[\p{L}][\p{L}'-]*/gu) ?? [];
}

function rankedEntries(entries: Map<string, number>, limit: number, minimum = 1) {
  return [...entries.entries()]
    .filter(([, count]) => count >= minimum)
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function share(part: number, total: number) {
  return total === 0 ? null : part / total;
}

function referencedSequences(text: string) {
  const sequences = new Set<number>();
  const leading = text.match(LEADING_REFERENCE);
  if (leading) sequences.add(Number(leading[1]));

  for (const match of text.matchAll(REFERENCE)) {
    sequences.add(Number(match[1]));
  }

  return sequences;
}

function buildConversationSignal(messages: PublicMessage[]): ConversationSignal {
  const orderedMessages = [...messages].sort((left, right) => left.seq - right.seq);
  if (orderedMessages.length < 8) {
    return {
      state: 'insufficient',
      label: 'Insufficient evidence',
      summary: 'This sample is too small to distinguish a conversation from isolated activity.',
      linkedReplies: 0,
      linkedParticipants: 0,
      linkedQuestionResponses: 0,
      templatePressure: null,
      oneShotSenderShare: null,
      messagesPerMinute: null,
      burst: false,
    };
  }

  const messagesBySequence = new Map(orderedMessages.map((message) => [message.seq, message]));
  const linkedReplySequences = new Set<number>();
  const linkedParticipants = new Set<string>();
  const linkedQuestionResponses = new Set<number>();

  for (const message of orderedMessages) {
    for (const sequence of referencedSequences(message.text)) {
      const referenced = messagesBySequence.get(sequence);
      if (!referenced || referenced.seq >= message.seq || referenced.from === message.from) continue;

      linkedReplySequences.add(message.seq);
      linkedParticipants.add(message.from);
      linkedParticipants.add(referenced.from);
      if (referenced.text.includes('?')) linkedQuestionResponses.add(message.seq);
    }
  }

  const templateTextCounts = new Map<string, number>();
  const templatePhraseCounts = new Map<string, number>();
  const templateTokens = orderedMessages.map((message) => templateWords(message.text));
  for (const words of templateTokens) {
    const normalizedText = words.join(' ');
    if (normalizedText) templateTextCounts.set(normalizedText, (templateTextCounts.get(normalizedText) ?? 0) + 1);

    const phrasesInMessage = new Set<string>();
    for (let index = 0; index <= words.length - 5; index += 1) {
      phrasesInMessage.add(words.slice(index, index + 5).join(' '));
    }
    for (const phrase of phrasesInMessage) {
      templatePhraseCounts.set(phrase, (templatePhraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  const templateMessages = templateTokens.reduce((total, words) => {
    const normalizedText = words.join(' ');
    const repeatedText = normalizedText.length > 0 && (templateTextCounts.get(normalizedText) ?? 0) >= 4;
    const repeatedPhrase = words.some((_, index) => (
      index <= words.length - 5 && (templatePhraseCounts.get(words.slice(index, index + 5).join(' ')) ?? 0) >= 4
    ));
    return total + Number(repeatedText || repeatedPhrase);
  }, 0);

  const senderCounts = new Map<string, number>();
  for (const message of orderedMessages) {
    senderCounts.set(message.from, (senderCounts.get(message.from) ?? 0) + 1);
  }
  const oneShotSenderMessages = [...senderCounts.values()].reduce(
    (total, count) => total + (count === 1 ? count : 0),
    0,
  );

  const firstTime = Date.parse(orderedMessages[0]?.ts ?? '');
  const lastTime = Date.parse(orderedMessages.at(-1)?.ts ?? '');
  const spanSeconds = Number.isFinite(firstTime) && Number.isFinite(lastTime)
    ? Math.max(0, (lastTime - firstTime) / 1000)
    : null;
  const messagesPerMinute = spanSeconds === null || spanSeconds === 0
    ? null
    : (orderedMessages.length / spanSeconds) * 60;
  const burst = orderedMessages.length >= 12 && spanSeconds !== null && spanSeconds <= 60;
  const templatePressure = share(templateMessages, orderedMessages.length);
  const oneShotSenderShare = share(oneShotSenderMessages, orderedMessages.length);
  const highTemplatePressure = templatePressure !== null && templatePressure >= 0.5;
  const highChurnBurst = burst && oneShotSenderShare !== null && oneShotSenderShare >= 0.7;
  const highRisk = highTemplatePressure || highChurnBurst;
  const linkedReplyCount = linkedReplySequences.size;
  const requiredLinks = orderedMessages.length < 50 ? 2 : 3;
  const requiredParticipants = 2;

  if (
    linkedReplyCount >= requiredLinks
    && linkedParticipants.size >= requiredParticipants
    && linkedQuestionResponses.size > 0
    && !highRisk
  ) {
    return {
      state: 'conversation_observed',
      label: 'Linked exchange observed',
      summary: 'Cross-author replies point to earlier messages, including a linked response to a question, with limited template pressure.',
      linkedReplies: linkedReplyCount,
      linkedParticipants: linkedParticipants.size,
      linkedQuestionResponses: linkedQuestionResponses.size,
      templatePressure,
      oneShotSenderShare,
      messagesPerMinute,
      burst,
    };
  }

  if (linkedReplyCount > 0) {
    return {
      state: 'mixed',
      label: 'Mixed signal',
      summary: highRisk
        ? 'Some cross-author replies appear, but recurring templates or high-churn burst activity dominate the sample.'
        : 'Some cross-author replies appear, but there is not enough evidence of a sustained linked exchange.',
      linkedReplies: linkedReplyCount,
      linkedParticipants: linkedParticipants.size,
      linkedQuestionResponses: linkedQuestionResponses.size,
      templatePressure,
      oneShotSenderShare,
      messagesPerMinute,
      burst,
    };
  }

  if (highRisk) {
    return {
      state: highTemplatePressure ? 'template_heavy' : 'high_churn',
      label: highTemplatePressure ? 'Template-heavy activity' : 'High-churn activity',
      summary: highTemplatePressure
        ? 'No validated cross-author reply links appeared, while recurring normalized templates did.'
        : 'No validated cross-author reply links appeared, while a high-churn burst did.',
      linkedReplies: 0,
      linkedParticipants: 0,
      linkedQuestionResponses: 0,
      templatePressure,
      oneShotSenderShare,
      messagesPerMinute,
      burst,
    };
  }

  return {
    state: 'no_conversation_evidence',
    label: 'No linked exchange observed',
    summary: 'No explicit cross-author reply links appeared in this sample.',
    linkedReplies: 0,
    linkedParticipants: 0,
    linkedQuestionResponses: 0,
    templatePressure,
    oneShotSenderShare,
    messagesPerMinute,
    burst,
  };
}

export function buildConversationMap(room: string, messages: PublicMessage[]): ConversationMap {
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
    signal: buildConversationSignal(orderedMessages),
  };
}
