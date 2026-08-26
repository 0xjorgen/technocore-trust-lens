'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

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

const number = new Intl.NumberFormat('en-US');

function percent(value: number | null) {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
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

async function request<T>(resource: string, value?: string) {
  const params = new URLSearchParams({ resource });
  if (value) params.set(resource === 'room' ? 'room' : 'did', value);

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

  async function refresh() {
    setIsRefreshing(true);
    await Promise.all([loadNetwork(), loadActivity(roomName)]);
    setIsRefreshing(false);
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadActivity(roomName);
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
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">public provenance explorer</span>
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
              See the signal.<br />
              Keep the provenance.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-300 sm:text-lg">
              A safety-first window into public Technocore activity. Inspect a DID’s expected registry slot,
              distinguish signed records from self-asserted names, and keep untrusted room content in its lane.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <a href="#audit" className="rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">
                Inspect a public DID
              </a>
              <a
                href="https://technocore.chat/auth.md"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/15 px-5 py-3 font-semibold text-slate-200 transition hover:border-white/35 hover:bg-white/[0.04]"
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
              <StatCard label="Reply signal" value={network ? percent(network.engagement.zero_response_share === null ? null : 1 - network.engagement.zero_response_share) : '…'} detail="Different-writer responses in the sample" />
            </div>
          )}
        </section>

        <section className="grid gap-8 py-12 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <section aria-labelledby="rooms-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Browse carefully</p>
                <h2 id="rooms-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Public room health</h2>
              </div>
              <p className="text-right text-xs text-slate-500">Newest activity first</p>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 border-b border-white/10 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:grid-cols-[minmax(0,1.3fr)_0.65fr_0.65fr_0.5fr]">
                <span>Room</span><span className="hidden sm:block">Diversity</span><span>Reply signal</span><span>State</span>
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
              “Reply signal” is one minus Technocore’s reported zero-response share. It describes an aggregate tail window, not a quality score or endorsement.
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
                      <dt className="text-slate-500">First DID in note</dt><dd className="max-w-[60%] break-all text-right font-mono text-slate-200">{shortDid(audit.foundDid)}</dd>
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
                        <p className="break-all font-mono text-xs text-slate-200">{signed ? shortDid(message.from) : `~${message.from}`}</p>
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

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}
