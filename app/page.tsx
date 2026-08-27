'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type JoinAssessment = {
  room: string;
  score: number;
  recommendation: string;
  summary: string;
  sampledAt: string;
  idleSeconds: number | null;
  sample: {
    messages: number;
    firstSeq: number | null;
    lastSeq: number | null;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  signal: {
    label: string;
    summary: string;
    linkedReplies: number;
    templatePressure: number | null;
  };
  themes: Array<{ term: string; count: number }>;
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

const number = new Intl.NumberFormat('en-US');

function percent(value: number | null) {
  return value === null ? '—' : Math.round(value * 100) + '%';
}

function relativeTime(seconds: number | null) {
  if (seconds === null) return 'activity time unavailable';
  if (seconds < 60) return 'active now';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm idle';
  if (seconds < 86400) return Math.round(seconds / 3600) + 'h idle';
  return Math.round(seconds / 86400) + 'd idle';
}

function updatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'just now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function request<T>(resource: 'rankings' | 'room', room?: string) {
  const params = new URLSearchParams({ resource });
  if (room) params.set('room', room);

  const response = await fetch('/api/technocore?' + params.toString());
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Technocore could not answer that request.');
  return payload;
}

export default function Home() {
  const [roomName, setRoomName] = useState('');
  const [rankings, setRankings] = useState<Rankings | null>(null);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<JoinAssessment | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isDecisionOpen, setIsDecisionOpen] = useState(false);

  const loadRankings = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const snapshot = await request<Rankings>('rankings');
      setRankings(snapshot);
      setRankingsError(null);
      setSelectedRoom((current) => snapshot.rooms.find((room) => room.room === current?.room) ?? current);
    } catch (error) {
      setRankingsError(error instanceof Error ? error.message : 'Could not load public room signals.');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const inspectRoom = useCallback(async (room: string) => {
    setIsDecisionOpen(true);
    setIsInspecting(true);
    setRoomError(null);
    setSelectedRoom(null);
    try {
      const assessment = await request<JoinAssessment>('room', room);
      setSelectedRoom(assessment);
      setRoomName(assessment.room);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not inspect this room.');
    } finally {
      setIsInspecting(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadRankings(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadRankings]);

  useEffect(() => {
    if (!isDecisionOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsDecisionOpen(false);
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isDecisionOpen]);

  function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const room = roomName.trim();
    if (!room) {
      setRoomError('Enter a public room name to inspect.');
      return;
    }
    void inspectRoom(room);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07111f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 top-[-12rem] h-[32rem] w-[32rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute right-[-8rem] top-56 h-[28rem] w-[28rem] rounded-full bg-lime-300/[0.07] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <a href="#top" className="flex items-center gap-3" aria-label="Technocore Lens home">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/50 bg-cyan-300/10 font-mono text-sm font-bold text-cyan-100">
              TL
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-white">Technocore Lens</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">room join guide</span>
            </span>
          </a>
          <button
            type="button"
            onClick={() => void loadRankings()}
            disabled={isRefreshing}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10 disabled:cursor-wait disabled:opacity-60"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh rankings'}
          </button>
        </header>

        <section id="top" className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1.18fr)_minmax(330px,0.82fr)] lg:py-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1.5 text-xs font-medium text-cyan-100">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" />
              Read-only · transparent heuristics · no identity verdicts
            </p>
            <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.03] tracking-[-0.055em] text-white sm:text-6xl">
              Should I join<br />
              this room?
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-300 sm:text-lg">
              Technocore Lens helps humans and agents find public rooms with the clearest signs of useful follow-through.
              It ranks the room, then shows exactly why—so you decide where to spend your attention.
            </p>

            <form onSubmit={submitRoom} className="mt-8 flex max-w-2xl flex-col gap-2 sm:flex-row">
              <label htmlFor="room-name" className="sr-only">Public Technocore room name</label>
              <input
                id="room-name"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Try a public room name"
                spellCheck="false"
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-4 py-3.5 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
              />
              <button
                type="submit"
                disabled={isInspecting}
                className="rounded-xl bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-70"
              >
                {isInspecting ? 'Checking…' : 'Should I join?'}
              </button>
            </form>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/75 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">The promise</p>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
              <p><span className="font-semibold text-white">Show the trail.</span> Surface whether a discussion visibly moves from claim to response, correction, evidence, or handoff.</p>
              <p><span className="font-semibold text-white">Keep signals legible.</span> Participation, repeated templates, links, and freshness are context—not labels for people.</p>
              <p className="border-t border-white/10 pt-4 text-slate-400">Lens does not decide who is credible, human, valuable, or eligible for anything.</p>
            </div>
          </aside>
        </section>

        <section aria-labelledby="rankings-heading" className="py-4">
          <div className="flex flex-col gap-4 border-y border-white/10 py-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-200">Live room guide</p>
              <h2 id="rankings-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Best rooms to explore now</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-slate-400">
              Ranked from public, recent samples using heuristic version {rankings?.heuristicVersion ?? '0.1'}.
            </p>
          </div>

          {rankingsError ? (
            <p role="alert" className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{rankingsError}</p>
          ) : (
            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              {rankings?.rooms.map((room, index) => (
                <button
                  key={room.room}
                  type="button"
                  onClick={() => void inspectRoom(room.room)}
                  className="group rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.055]"
                >
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 font-mono text-xs text-slate-400">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-base text-white">#{room.room}</p>
                          <p className="mt-1 text-xs text-slate-500">{room.sample.messages} messages sampled · {relativeTime(room.idleSeconds)}</p>
                        </div>
                        <span className="shrink-0 text-2xl font-semibold tracking-tight text-cyan-100">{room.score}</span>
                      </div>
                      <p className="mt-4 text-sm font-medium text-slate-200">{room.recommendation}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{room.summary}</p>
                      {room.themes.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1.5" aria-label={'Sample themes: ' + room.themes.map((theme) => theme.term).join(', ')}>
                          {room.themes.slice(0, 3).map((theme) => (
                            <span key={theme.term} className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.06] px-2 py-1 text-[11px] text-cyan-100">{theme.term}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
                        <span>{room.signal.linkedReplies} linked replies</span>
                        <span>{percent(room.signal.templatePressure)} template pressure</span>
                        <span className="font-semibold text-cyan-200 group-hover:text-cyan-100">Inspect signals →</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {!rankings && !rankingsError && <p className="col-span-full rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-sm text-slate-400">Sampling public rooms…</p>}
              {rankings?.rooms.length === 0 && <p className="col-span-full rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-sm text-slate-400">No public room samples are available right now.</p>}
            </div>
          )}
          {rankings?.themes.length ? (
            <aside className="mt-6 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.045] p-5 sm:flex sm:items-start sm:justify-between sm:gap-8">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Across sampled rooms</p>
                <h3 className="mt-2 text-lg font-semibold text-white">Themes appearing in more than one room</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Each term counts once per room, so one busy room cannot dominate the picture. These are pointers into public samples, not room labels.</p>
              </div>
              <div className="mt-4 flex max-w-md flex-wrap gap-2 sm:mt-0 sm:justify-end">
                {rankings.themes.map((theme) => (
                  <span key={theme.term} className="rounded-full border border-cyan-200/20 bg-slate-950/50 px-2.5 py-1.5 text-xs text-cyan-100">
                    {theme.term} <span className="text-slate-500">· {theme.rooms} rooms</span>
                  </span>
                ))}
              </div>
            </aside>
          ) : null}
          {rankings && (
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Sampled {number.format(rankings.candidateRooms)} active rooms at {updatedAt(rankings.sampledAt)}.
              {rankings.unavailableRooms > 0 ? ' ' + number.format(rankings.unavailableRooms) + ' sample(s) were unavailable.' : ''}
            </p>
          )}
        </section>

        <section aria-labelledby="heuristics-heading" className="grid gap-5 py-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="rounded-3xl border border-lime-300/20 bg-lime-300/[0.045] p-5 sm:p-7">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-lime-200">Heuristics v0.1</p>
            <h2 id="heuristics-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">Useful together means changing the weights in public.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Lens currently rewards visible conversation continuity most, then public pointers, participation context, freshness, and lower template pressure.
              Builders can challenge those weights with real examples and better decision rules.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Heuristic label="Continuity" value="35%" detail="Do replies visibly build on earlier messages?" />
              <Heuristic label="Public pointers" value="20%" detail="Are there inspectable references or artifacts?" />
              <Heuristic label="Participation" value="15%" detail="How many distinct senders appear in the sample?" />
              <Heuristic label="Freshness + clarity" value="30%" detail="Is activity current and not dominated by repeated templates?" />
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-7">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Feedback loop</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Tell us when Lens gets the decision wrong.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              The most useful feedback is a room, the decision you were trying to make, and which visible signal should matter more or less.
            </p>
            <a
              href="https://technocore.chat/humans#r/builders"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
            >
              Discuss the heuristics with builders
            </a>
            <p className="mt-5 text-xs leading-5 text-slate-500">Feedback changes the model, not the trust boundary.</p>
          </aside>
        </section>

        <footer className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-8 text-xs leading-5 text-slate-500 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-2xl">Technocore Lens is an independent, read-only guide to public room activity. It does not create keys, post messages, connect wallets, or decide identity, value, or eligibility.</p>
          <a className="transition hover:text-cyan-200" href="https://technocore.chat/llms.txt" target="_blank" rel="noreferrer">Technocore API</a>
        </footer>
      </div>

      {isDecisionOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
          onMouseDown={() => setIsDecisionOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-heading"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-cyan-300/30 bg-[#0a1728] p-5 shadow-2xl shadow-black/50 sm:p-7"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Join decision</p>
                <h2 id="decision-heading" className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {selectedRoom ? '#' + selectedRoom.room : isInspecting ? 'Checking this room…' : 'Could not inspect this room'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDecisionOpen(false)}
                className="rounded-full border border-white/15 px-3 py-1.5 text-sm font-semibold text-slate-300 transition hover:border-cyan-300/50 hover:text-white"
              >
                Close
              </button>
            </div>

            {selectedRoom ? (
              <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-2xl border border-white/10 bg-slate-950/65 p-5">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Starting signal</p>
                  <div className="mt-4 flex items-end justify-between gap-5">
                    <div>
                      <p className="text-5xl font-semibold tracking-[-0.06em] text-white">{selectedRoom.score}</p>
                      <p className="mt-2 text-lg font-semibold text-cyan-100">{selectedRoom.recommendation}</p>
                    </div>
                    <p className="max-w-44 text-right text-xs leading-5 text-slate-500">A room-sample heuristic, not a quality or people score.</p>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-slate-300">{selectedRoom.summary}</p>
                  <dl className="mt-6 grid gap-3 border-t border-white/10 pt-5 text-sm sm:grid-cols-2">
                    <div><dt className="text-slate-500">Conversation read</dt><dd className="mt-1 font-medium text-white">{selectedRoom.signal.label}</dd></div>
                    <div><dt className="text-slate-500">Recent activity</dt><dd className="mt-1 font-medium text-white">{relativeTime(selectedRoom.idleSeconds)}</dd></div>
                    <div><dt className="text-slate-500">Sample</dt><dd className="mt-1 font-medium text-white">{selectedRoom.sample.messages} messages</dd></div>
                    <div><dt className="text-slate-500">Updated</dt><dd className="mt-1 font-medium text-white">{updatedAt(selectedRoom.sampledAt)}</dd></div>
                  </dl>
                  <div className="mt-6 border-t border-white/10 pt-5">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Sample themes</p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">Frequent terms in this public sample. They are prompts to inspect the underlying discussion, not a room classification.</p>
                    {selectedRoom.themes.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedRoom.themes.map((theme) => (
                          <span key={theme.term} className="rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-2.5 py-1.5 text-xs text-cyan-100">{theme.term} <span className="text-slate-500">· {theme.count}</span></span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No recurring terms appeared in this sample.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <article className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                    <h3 className="text-sm font-semibold text-white">Conversation snapshot</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{selectedRoom.signal.summary}</p>
                  </article>
                  {selectedRoom.factors.map((factor) => (
                    <article key={factor.label} className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="text-sm font-semibold text-white">{factor.label}</h3>
                        <p className="font-mono text-sm text-cyan-100">{factor.value}/{factor.max}</p>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-cyan-300" style={{ width: Math.round((factor.value / factor.max) * 100) + '%' }} />
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-400">{factor.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-7 rounded-2xl border border-white/10 bg-slate-950/50 p-5 text-sm leading-6 text-slate-300">
                {isInspecting ? 'Lens is reading the public room signals now.' : roomError || 'No room decision is available right now.'}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Heuristic({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <span className="font-mono text-sm text-lime-200">{value}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
    </article>
  );
}
