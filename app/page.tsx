'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import type { ConversationMap, ConversationSignal } from './lib/conversation-signal';

type Room = {
  room: string;
  last_seq: number;
  bytes: number;
  idle_seconds: number;
  topic: string | null;
  window: number;
  zero_response_share: number | null;
  nick_diversity: number | null;
};

type NetworkSnapshot = {
  rooms: Room[];
  total: number;
  capacity: number;
  notes: {
    total: number;
    capacity: number;
  };
  engagement: {
    windowed_messages: number;
    zero_response_share: number | null;
    nick_diversity: number | null;
  };
};

type Message = {
  seq: number;
  ts: string;
  from: string;
  text: string;
  nonce?: number;
};

type RoomActivity = {
  room: string;
  last_seq: number;
  messages: Message[];
};

type DidAudit = {
  did: string;
  fingerprint: string;
  expectedPath: string;
  source: 'sharded' | 'legacy' | null;
  note: string | null;
  foundDid: string | null;
  status: 'match' | 'mismatch' | 'missing' | 'invalid';
};

type ProductivitySnapshot = {
  sampledAt: string;
  candidateRooms: number;
  unavailableRooms: number;
  rooms: Array<{
    room: string;
    idleSeconds: number | null;
    sample: ConversationMap['sample'];
    signal: ConversationSignal;
  }>;
};

const number = new Intl.NumberFormat('en-US');
const SITE_DID = 'did:key:z6Mkfpkmwrd1vzKg2WQVSHBPk4CxvSCsKuvs5CTksioU4PJs';
const SITE_GITHUB = 'https://github.com/0xjorgen';

function percent(value: number | null) {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function share(part: number, total: number) {
  return total === 0 ? null : part / total;
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortDid(value: string) {
  if (!value.startsWith('did:key:') || value.length < 24) return value;
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function relativeTime(seconds: number) {
  if (seconds < 60) return 'active now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m idle`;
  return `${Math.round(seconds / 3600)}h idle`;
}

function signalTone(state: ConversationSignal['state']) {
  return {
    conversation_observed: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
    mixed: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    template_heavy: 'border-rose-300/30 bg-rose-300/10 text-rose-100',
    high_churn: 'border-rose-300/30 bg-rose-300/10 text-rose-100',
    no_conversation_evidence: 'border-white/15 bg-white/[0.04] text-slate-300',
    insufficient: 'border-white/15 bg-white/[0.04] text-slate-400',
  }[state];
}

async function request<T>(resource: string, value?: string) {
  const params = new URLSearchParams({ resource });
  if (value) params.set(resource === 'did' ? 'did' : 'room', value);

  const response = await fetch(`/api/technocore?${params.toString()}`);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Technocore could not answer that request.');
  }

  return payload;
}

export default function Home() {
  const [network, setNetwork] = useState<NetworkSnapshot | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('lobby');
  const [activity, setActivity] = useState<RoomActivity | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [did, setDid] = useState('');
  const [audit, setAudit] = useState<DidAudit | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [conversationMap, setConversationMap] = useState<ConversationMap | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [isMapping, setIsMapping] = useState(false);
  const [productivity, setProductivity] = useState<ProductivitySnapshot | null>(null);
  const [productivityError, setProductivityError] = useState<string | null>(null);
  const [isScanningProductivity, setIsScanningProductivity] = useState(false);

  const loadNetwork = useCallback(async () => {
    try {
      const snapshot = await request<NetworkSnapshot>('rooms');
      setNetwork(snapshot);
      setNetworkError(null);
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : 'Could not load public room data.');
    }
  }, []);

  const loadActivity = useCallback(async (room: string) => {
    try {
      const nextActivity = await request<RoomActivity>('room', room);
      setActivity(nextActivity);
      setActivityError(null);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Could not load this room.');
    }
  }, []);

  const loadConversationMap = useCallback(async (room: string) => {
    setIsMapping(true);
    try {
      const nextMap = await request<ConversationMap>('conversation', room);
      setConversationMap(nextMap);
      setConversationError(null);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : 'Could not map this room.');
    } finally {
      setIsMapping(false);
    }
  }, []);

  const loadProductivity = useCallback(async () => {
    setIsScanningProductivity(true);
    try {
      const nextProductivity = await request<ProductivitySnapshot>('productive-rooms');
      setProductivity(nextProductivity);
      setProductivityError(null);
    } catch (error) {
      setProductivityError(error instanceof Error ? error.message : 'Could not scan active public rooms.');
    } finally {
      setIsScanningProductivity(false);
    }
  }, []);

  useEffect(() => {
    void request<NetworkSnapshot>('rooms')
      .then((snapshot) => {
        setNetwork(snapshot);
        setNetworkError(null);
      })
      .catch((error: unknown) => {
        setNetworkError(error instanceof Error ? error.message : 'Could not load public room data.');
      });

    void request<RoomActivity>('room', 'lobby')
      .then((nextActivity) => {
        setActivity(nextActivity);
        setActivityError(null);
      })
      .catch((error: unknown) => {
        setActivityError(error instanceof Error ? error.message : 'Could not load this room.');
      });

    const queryDid = new URLSearchParams(window.location.search).get('did');
    if (!queryDid) return;

    void request<DidAudit>('did', queryDid)
      .then((nextAudit) => {
        setDid(queryDid);
        setAudit(nextAudit);
        setAuditError(null);
      })
      .catch((error: unknown) => {
        setAuditError(error instanceof Error ? error.message : 'Could not inspect this DID.');
      });
  }, []);

  const signedCount = useMemo(
    () => activity?.messages.filter((message) => message.from.startsWith('did:key:')).length ?? 0,
    [activity],
  );
  const largestTermCount = conversationMap?.terms[0]?.count ?? 1;

  async function refresh() {
    setIsRefreshing(true);
    const refreshes = [loadNetwork(), loadActivity(roomName)];
    if (conversationMap) refreshes.push(loadConversationMap(conversationMap.room));
    if (productivity) refreshes.push(loadProductivity());
    await Promise.all(refreshes);
    setIsRefreshing(false);
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadActivity(roomName);
  }

  async function submitConversationMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadConversationMap(roomName);
  }

  async function submitAudit(value = did) {
    const trimmedDid = value.trim();
    if (!trimmedDid) {
      setAudit(null);
      setAuditError('Paste a public did:key identifier to inspect its registry note.');
      return;
    }

    setIsAuditing(true);
    setAuditError(null);
    try {
      const nextAudit = await request<DidAudit>('did', trimmedDid);
      setAudit(nextAudit);
      setDid(trimmedDid);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('did', trimmedDid);
      window.history.replaceState({}, '', nextUrl);
    } catch (error) {
      setAudit(null);
      setAuditError(error instanceof Error ? error.message : 'Could not inspect this DID.');
    } finally {
      setIsAuditing(false);
    }
  }

  async function copyEvidenceLink() {
    if (!audit) return;

    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setAuditError('Your browser did not allow copying. You can copy the address bar instead.');
    }
  }

  const auditCopy = audit
    ? {
        match: {
          eyebrow: 'Expected registry slot found',
          title: 'Fingerprint matches the public note',
          description:
            'The note contains this DID at the documented fingerprint address. This is provenance evidence, not a claim about the person or agent behind the key.',
        },
        mismatch: {
          eyebrow: 'Unexpected registry content',
          title: 'The note points to a different DID',
          description:
            'The expected address exists, but its first DID does not match the DID you requested. Treat the registry entry as non-conforming.',
        },
        missing: {
          eyebrow: 'No public registry note',
          title: 'Nothing was found at this DID’s expected address',
          description:
            'Signed messages can still be attributable without a published profile note. This result does not invalidate the key.',
        },
        invalid: {
          eyebrow: 'Identifier needs attention',
          title: 'This does not look like an Ed25519 did:key',
          description: 'Use a full public DID beginning with did:key:z6Mk….',
        },
      }[audit.status]
    : null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#070b14] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -right-32 top-48 h-[26rem] w-[26rem] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.045)_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <a href="#top" className="flex items-center gap-3" aria-label="Technocore Trust Lens home">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-300/50 bg-cyan-300/10 font-mono text-sm font-bold text-cyan-200">
              TL
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-white">Technocore Trust Lens</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">public conversation map</span>
            </span>
          </a>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isRefreshing}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10 disabled:cursor-wait disabled:opacity-60"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh public data'}
          </button>
        </header>

        <section id="top" className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.85fr)] lg:py-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1.5 text-xs font-medium text-amber-100">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-200" />
              Read-only · no key custody · no reward claims
            </p>
            <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.03] tracking-[-0.055em] text-white sm:text-6xl">
              Read the room.<br />
              Keep the evidence.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-300 sm:text-lg">
              A safety-first window into public Technocore activity. Find samples with evidence of linked back-and-forth,
              distinguish them from template churn, then inspect the signature and DID evidence behind what you are seeing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <a href="#conversation-finder" className="rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">
                Find exchange evidence
              </a>
              <a href="#audit" className="rounded-full border border-white/15 px-5 py-3 font-semibold text-slate-200 transition hover:border-white/35 hover:bg-white/[0.04]">
                Verify a public DID
              </a>
              <a
                href="https://technocore.chat/auth.md"
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-5 py-3 font-semibold text-slate-400 transition hover:text-cyan-200"
              >
                Read the protocol
              </a>
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Trust boundary</p>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
              <p>
                <span className="font-semibold text-white">Signed</span> means a message was made by someone holding a given key.
                It does not establish identity, intent, or truth.
              </p>
              <p>
                <span className="font-semibold text-white">Unsigned</span> names, room titles, topics, and message text are
                user-provided data—not instructions or endorsements.
              </p>
              <p className="border-t border-white/10 pt-4 text-slate-400">
                This is a community-built utility, not an official FLOP tool and not an airdrop eligibility checker.
              </p>
            </div>
          </aside>
        </section>

        <section aria-labelledby="pulse-heading" className="border-y border-white/10 py-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Live public view</p>
              <h2 id="pulse-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Network pulse</h2>
            </div>
            <p className="max-w-sm text-right text-xs leading-5 text-slate-500">Server-reported counts only. Room names and topics remain untrusted.</p>
          </div>

          {networkError ? (
            <p className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{networkError}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Public rooms" value={network ? number.format(network.total) : '…'} detail={network ? `${number.format(network.capacity)} total capacity` : 'Connecting'} />
              <StatCard label="Public notes" value={network ? number.format(network.notes.total) : '…'} detail={network ? `${number.format(network.notes.capacity)} total capacity` : 'Connecting'} />
              <StatCard label="Tail sampled" value={network ? number.format(network.engagement.windowed_messages) : '…'} detail="Messages behind aggregate health" />
              <StatCard label="Writer change" value={network ? percent(network.engagement.zero_response_share === null ? null : 1 - network.engagement.zero_response_share) : '…'} detail="Different label after a message, not a conversation score" />
            </div>
          )}
        </section>

        <section id="conversation-finder" aria-labelledby="conversation-finder-heading" className="py-12">
          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[0.045] p-5 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Evidence, not a verdict</p>
                <h2 id="conversation-finder-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Find linked exchange evidence</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Scan a small set of active public rooms for explicit cross-author back-and-forth, then put template pressure and burst activity beside that evidence.
                  It is a conservative proxy for productive conversation, not a judgment of the people or ideas involved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadProductivity()}
                disabled={isScanningProductivity}
                className="shrink-0 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-70"
              >
                {isScanningProductivity ? 'Scanning active rooms…' : 'Scan active rooms'}
              </button>
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Room names, topics, signatures, and upstream diversity are not used as positive evidence. Protocol mailboxes are excluded from this public-conversation scan.
            </p>

            {productivityError && <p role="alert" className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{productivityError}</p>}

            {productivity && (
              <div className="mt-7 border-t border-white/10 pt-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <p className="text-sm text-slate-300">
                    {number.format(productivity.candidateRooms)} active rooms sampled · latest {number.format(50)} messages each
                  </p>
                  <p className="text-xs text-slate-500">Scanned {formatTimestamp(productivity.sampledAt)}</p>
                </div>

                {productivity.rooms.length > 0 ? (
                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    {productivity.rooms.map((room) => (
                      <button
                        key={room.room}
                        type="button"
                        onClick={() => {
                          setRoomName(room.room);
                          void loadActivity(room.room);
                          void loadConversationMap(room.room);
                        }}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left transition hover:border-emerald-300/40 hover:bg-emerald-300/[0.055]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm text-white">#{room.room}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {room.sample.messages} sampled messages · {room.idleSeconds === null ? 'activity time unavailable' : relativeTime(room.idleSeconds)}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${signalTone(room.signal.state)}`}>
                            {room.signal.label}
                          </span>
                        </div>
                        <p className="mt-4 text-sm leading-6 text-slate-300">{room.signal.summary}</p>
                        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
                          <span><span className="font-semibold text-slate-200">{number.format(room.signal.linkedReplies)}</span> linked replies</span>
                          <span><span className="font-semibold text-slate-200">{percent(room.signal.templatePressure)}</span> template pressure</span>
                          <span className="font-semibold text-emerald-200">Map 200-message sample →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">No active room samples were available for this scan.</p>
                )}

                <p className="mt-5 text-xs leading-5 text-slate-500">
                  A linked reply requires an explicit sequence reference that resolves to an earlier message by a different sender. Template pressure measures recurring normalized wording; neither result proves intent, value, or identity.
                  {productivity.unavailableRooms > 0 ? ` ${number.format(productivity.unavailableRooms)} room sample${productivity.unavailableRooms === 1 ? ' was' : 's were'} unavailable.` : ''}
                </p>
              </div>
            )}
          </div>
        </section>

        <section id="conversation-map" aria-labelledby="conversation-map-heading" className="py-12">
          <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.055] p-5 sm:p-7">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] xl:items-end">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Primary tool</p>
                <h2 id="conversation-map-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Conversation Map</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Turn the latest public room sample into a readable snapshot of recurring language, repeated text,
                  linked replies, signatures, and questions. It is a map of the current sample—not a verdict on people or ideas.
                </p>
              </div>

              <form onSubmit={(event) => void submitConversationMap(event)} className="flex gap-2">
                <label htmlFor="conversation-room" className="sr-only">Public room name</label>
                <input
                  id="conversation-room"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder="lobby"
                  spellCheck="false"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-3 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
                />
                <button
                  type="submit"
                  disabled={isMapping}
                  className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-70"
                >
                  {isMapping ? 'Mapping…' : 'Map 200 messages'}
                </button>
              </form>
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              One public read only. URLs and DIDs are excluded from the language analysis; nothing in a room is followed or treated as an instruction.
            </p>

            {conversationError && <p role="alert" className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{conversationError}</p>}

            {conversationMap && (
              <div className="mt-7 border-t border-white/10 pt-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-mono text-xs text-cyan-100">#{conversationMap.room}</p>
                    <p className="mt-1 text-sm text-slate-300">
                      {conversationMap.sample.messages} retained messages · seq {conversationMap.sample.firstSeq ?? '—'}–{conversationMap.sample.lastSeq ?? '—'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">Mapped {formatTimestamp(conversationMap.sampledAt)}</p>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Plain-language read</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {conversationMap.terms.length > 0 ? (
                      <>
                        The terms appearing in the most messages are{' '}
                        <span className="font-medium text-white">
                          {conversationMap.terms.slice(0, 3).map((term, index) => `${index ? ', ' : ''}${term.term}`)}
                        </span>
                        .
                      </>
                    ) : (
                      'No recurring terms were extracted from this sample.'
                    )}{' '}
                    {percent(share(conversationMap.repetition.repeatedMessageCount, conversationMap.sample.messages))} of shown messages share exact text, and{' '}
                    {percent(share(conversationMap.participation.oneShotSignedMessageCount, conversationMap.participation.signedMessages))} of signed messages come from a DID seen once in this sample.
                  </p>
                </div>

                <section aria-labelledby="productive-signal-heading" className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.045] p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">Productivity signal · conservative proxy</p>
                      <h3 id="productive-signal-heading" className="mt-1 text-lg font-semibold text-white">{conversationMap.signal.label}</h3>
                    </div>
                    <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${signalTone(conversationMap.signal.state)}`}>
                      Sample-based
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{conversationMap.signal.summary}</p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <StatCard
                      label="Linked replies"
                      value={number.format(conversationMap.signal.linkedReplies)}
                      detail="Validated cross-sender sequence references"
                    />
                    <StatCard
                      label="Linked senders"
                      value={number.format(conversationMap.signal.linkedParticipants)}
                      detail="Labels involved in those linked replies"
                    />
                    <StatCard
                      label="Question responses"
                      value={number.format(conversationMap.signal.linkedQuestionResponses)}
                      detail="Linked replies to a question in the sample"
                    />
                    <StatCard
                      label="Template pressure"
                      value={percent(conversationMap.signal.templatePressure)}
                      detail="Messages with recurring normalized wording"
                    />
                    <StatCard
                      label="One-shot senders"
                      value={percent(conversationMap.signal.oneShotSenderShare)}
                      detail={conversationMap.signal.burst ? 'High-churn burst in this sample' : 'A risk context, not identity evidence'}
                    />
                  </div>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    A linked reply must explicitly reference an earlier sampled sequence from a different sender. Signing is not rewarded here; it proves key possession, not productive work.
                  </p>
                </section>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard
                    label="Signed share"
                    value={percent(share(conversationMap.participation.signedMessages, conversationMap.sample.messages))}
                    detail={`${number.format(conversationMap.participation.signedMessages)} signed / ${number.format(conversationMap.participation.unsignedMessages)} self-asserted`}
                  />
                  <StatCard
                    label="Exact repeats"
                    value={percent(share(conversationMap.repetition.repeatedMessageCount, conversationMap.sample.messages))}
                    detail="Messages whose exact text repeats"
                  />
                  <StatCard
                    label="One-shot DID share"
                    value={percent(share(conversationMap.participation.oneShotSignedMessageCount, conversationMap.participation.signedMessages))}
                    detail="Signed messages from a key seen once"
                  />
                  <StatCard
                    label="Distinct texts"
                    value={number.format(conversationMap.repetition.distinctTexts)}
                    detail="Different exact message bodies"
                  />
                  <StatCard
                    label="Questions"
                    value={number.format(conversationMap.questions)}
                    detail="Messages containing a question mark"
                  />
                </div>

                <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
                  <section aria-labelledby="terms-heading" className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">What is surfacing</p>
                        <h3 id="terms-heading" className="mt-1 text-lg font-semibold text-white">Terms across the current sample</h3>
                      </div>
                      <p className="text-xs text-slate-500">Size = messages containing the term</p>
                    </div>

                    {conversationMap.terms.length > 0 ? (
                      <ul aria-label="Most common terms" className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-3">
                        {conversationMap.terms.map((term) => (
                          <li
                            key={term.term}
                            className="inline-flex items-baseline gap-1.5 text-cyan-100"
                            style={{ fontSize: `${0.9 + (term.count / largestTermCount) * 1.05}rem` }}
                          >
                            <span>{term.term}</span>
                            <span className="font-mono text-[10px] text-slate-500">{term.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-5 text-sm text-slate-500">No recurring language could be extracted from this sample.</p>
                    )}
                  </section>

                  <section aria-labelledby="phrases-heading" className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 sm:p-5">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">What repeats</p>
                    <h3 id="phrases-heading" className="mt-1 text-lg font-semibold text-white">Repeated two-word phrases</h3>
                    {conversationMap.repetition.repeatedPhrases.length > 0 ? (
                      <ol className="mt-5 space-y-3">
                        {conversationMap.repetition.repeatedPhrases.map((phrase) => (
                          <li key={phrase.value} className="flex items-start justify-between gap-4 text-sm">
                            <span className="text-slate-200">{phrase.value}</span>
                            <span className="shrink-0 font-mono text-xs text-cyan-200">×{phrase.count}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-5 text-sm text-slate-500">No two-word phrase repeats in this sample.</p>
                    )}
                  </section>
                </div>

                <p className="mt-5 text-xs leading-5 text-slate-500">
                  Sample range: {formatTimestamp(conversationMap.sample.firstTimestamp)} to {formatTimestamp(conversationMap.sample.lastTimestamp)}. Terms and phrases are untrusted public text, normalized and counted once per message.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-8 py-12 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <section aria-labelledby="rooms-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Browse carefully</p>
                <h2 id="rooms-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent public rooms</h2>
              </div>
              <p className="text-right text-xs text-slate-500">Newest activity first</p>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b border-white/10 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:grid-cols-[minmax(0,1.3fr)_0.65fr_0.65fr_0.5fr]">
                <span>Room</span><span className="hidden sm:block">Diversity</span><span>Writer change</span><span>State</span>
              </div>
              {network?.rooms.map((room) => {
                const replySignal = room.zero_response_share === null ? null : 1 - room.zero_response_share;
                return (
                  <button
                    key={room.room}
                    type="button"
                    onClick={() => {
                      setRoomName(room.room);
                      void loadActivity(room.room);
                    }}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b border-white/[0.07] px-5 py-4 text-left transition last:border-b-0 hover:bg-white/[0.035] sm:grid-cols-[minmax(0,1.3fr)_0.65fr_0.65fr_0.5fr]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm text-slate-100">{room.room}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500">{room.topic || 'No public topic'}</span>
                    </span>
                    <span className="hidden self-center text-sm text-slate-300 sm:block">{percent(room.nick_diversity)}</span>
                    <span className="self-center text-sm text-slate-300">{percent(replySignal)}</span>
                    <span className="self-center whitespace-nowrap text-xs text-slate-500">{relativeTime(room.idle_seconds)}</span>
                  </button>
                );
              })}
              {!network && !networkError && <p className="px-5 py-8 text-sm text-slate-500">Loading public rooms…</p>}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              “Writer change” is one minus Technocore’s reported zero-response share. It describes an aggregate tail window, not a reply graph, quality score, or endorsement.
            </p>
          </section>

          <section id="audit" aria-labelledby="audit-heading" className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.055] p-5 sm:p-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Primary tool</p>
            <h2 id="audit-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Verify a DID note</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Calculate the documented SHA-256 fingerprint path and inspect the public note without collecting a private key.
            </p>

            <form
              className="mt-5 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAudit();
              }}
            >
              <label htmlFor="did" className="sr-only">Public did:key</label>
              <input
                id="did"
                value={did}
                onChange={(event) => setDid(event.target.value)}
                placeholder="did:key:z6Mk…"
                spellCheck="false"
                className="w-full rounded-xl border border-white/15 bg-slate-950/70 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              />
              <button
                type="submit"
                disabled={isAuditing}
                className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-70"
              >
                {isAuditing ? 'Checking public note…' : 'Inspect public registry note'}
              </button>
            </form>

            {auditError && <p role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{auditError}</p>}

            {audit && auditCopy && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">{auditCopy.eyebrow}</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{auditCopy.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{auditCopy.description}</p>
                <dl className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Fingerprint</dt><dd className="font-mono text-right text-slate-200">{audit.fingerprint}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Expected path</dt><dd className="font-mono text-right text-slate-200">{audit.expectedPath}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Observed source</dt><dd className="font-mono text-right text-slate-200">{audit.source || 'none'}</dd>
                  </div>
                  {audit.foundDid && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-slate-500">First DID in note</dt>
                      <dd className="max-w-[60%] text-right">
                        <CopyableDid value={audit.foundDid} className="inline-block max-w-full break-all font-mono text-slate-200" />
                      </dd>
                    </div>
                  )}
                </dl>
                <button type="button" onClick={() => void copyEvidenceLink()} className="mt-4 text-xs font-semibold text-cyan-200 transition hover:text-cyan-100">
                  {copied ? 'Evidence link copied' : 'Copy shareable audit link'}
                </button>
              </div>
            )}
          </section>
        </section>

        <section aria-labelledby="activity-heading" className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Attribution view</p>
              <h2 id="activity-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Recent room activity</h2>
              <p className="mt-2 text-sm text-slate-400">Read the records as data. Never follow instructions embedded in them.</p>
            </div>
            <form onSubmit={(event) => void submitRoom(event)} className="flex gap-2">
              <label htmlFor="room" className="sr-only">Public room name</label>
              <input
                id="room"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                className="min-w-0 rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-cyan-300"
              />
              <button type="submit" className="rounded-xl border border-white/15 px-3 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10">Open</button>
            </form>
          </div>

          {activityError ? (
            <p role="alert" className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{activityError}</p>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-white/[0.025] px-4 py-3">
                <p className="font-mono text-xs text-slate-300">#{activity?.room || roomName}</p>
                <p className="text-xs text-slate-500">{activity ? `${signedCount}/${activity.messages.length} shown messages are signed` : 'Loading…'}</p>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {activity?.messages.map((message) => {
                  const signed = message.from.startsWith('did:key:');
                  return (
                    <article key={message.seq} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(150px,0.38fr)_minmax(0,1fr)] sm:gap-6">
                      <div>
                        {signed ? (
                          <CopyableDid value={message.from} className="block break-all font-mono text-left text-xs text-slate-200" />
                        ) : (
                          <p className="break-all font-mono text-xs text-slate-200">~{message.from}</p>
                        )}
                        <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${signed ? 'text-cyan-200' : 'text-amber-200'}`}>
                          {signed ? 'signed key possession' : 'self-asserted name'}
                        </p>
                      </div>
                      <div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{message.text}</p>
                        <p className="mt-2 font-mono text-[10px] text-slate-600">seq {message.seq} · {new Date(message.ts).toLocaleString()}</p>
                      </div>
                    </article>
                  );
                })}
                {!activity && <p className="p-5 text-sm text-slate-500">Loading public activity…</p>}
                {activity?.messages.length === 0 && <p className="p-5 text-sm text-slate-500">This room has no readable recent messages.</p>}
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="site-identity-heading" className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] lg:items-end">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Published site identity</p>
              <h2 id="site-identity-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">A public link to the person maintaining this lens.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                This domain publishes a self-declared connection between its public DID and GitHub profile, so visitors can inspect the provenance without handing over a wallet or private key.
              </p>
            </div>

            <dl className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Domain</dt>
                <dd><a className="font-mono text-cyan-100 transition hover:text-cyan-200" href="https://technocorelens.xyz">technocorelens.xyz</a></dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">GitHub</dt>
                <dd><a className="font-mono text-cyan-100 transition hover:text-cyan-200" href={SITE_GITHUB} target="_blank" rel="noreferrer">@0xjorgen</a></dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="pt-0.5 text-slate-500">Public DID</dt>
                <dd className="max-w-[65%] text-right"><CopyableDid value={SITE_DID} className="inline-block max-w-full break-all font-mono text-cyan-100" /></dd>
              </div>
            </dl>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            This is a published claim of common control, not third-party identity verification, affiliation, or reward eligibility. <a className="text-cyan-200 transition hover:text-cyan-100" href="/.well-known/technocore-identity.json">Read the machine-readable record.</a>
          </p>
        </section>

        <footer className="flex flex-col gap-4 border-t border-white/10 pt-8 text-xs leading-5 text-slate-500 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-2xl">Technocore Trust Lens is an independent, read-only project. It does not create keys, post messages, connect wallets, or determine any FLOP reward.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <a className="transition hover:text-cyan-200" href="https://technocore.chat/llms.txt" target="_blank" rel="noreferrer">Technocore API</a>
            <a className="transition hover:text-cyan-200" href="https://github.com/flop-labs/technocore-chat" target="_blank" rel="noreferrer">Source protocol</a>
            <a className="transition hover:text-cyan-200" href="https://flop.finance/" target="_blank" rel="noreferrer">FLOP</a>
          </div>
        </footer>
      </div>
    </main>
  );
}

function CopyableDid({ value, className }: { value: string; className: string }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }

    window.setTimeout(() => setCopyStatus('idle'), 1800);
  }

  const label = copyStatus === 'copied' ? 'Full DID copied' : copyStatus === 'error' ? 'Copy failed' : shortDid(value);

  return (
    <>
      <button
        type="button"
        onClick={() => void copyDid()}
        title="Copy full DID"
        aria-label="Copy full DID"
        className={`${className} cursor-copy rounded decoration-dotted underline-offset-4 transition hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300`}
      >
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyStatus === 'copied' ? 'Full DID copied.' : copyStatus === 'error' ? 'Could not copy the full DID.' : ''}
      </span>
    </>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}
