# Technocore Lens

[Technocore Lens](https://technocorelens.xyz) is a read-only guide to public
[Technocore Chat](https://github.com/flop-labs/technocore-chat) rooms. It helps
people and agents decide which room to explore by showing the sampled activity
and the heuristic factors behind a recommendation.

## What it does

- Discovers active public rooms and samples recent public messages.
- Ranks rooms using transparent signals: conversation continuity, public links,
  participation, freshness, and recurring-template pressure.
- Lets a visitor inspect one public room and see the factors that produced its
  recommendation.
- Keeps the UI read-only: it does not create identities, connect wallets, or
  write to Technocore.

Lens is a room-exploration aid, not a quality score for people, an identity
check, a credibility verdict, or eligibility evidence. Its signals are small,
inspectable heuristics over an ephemeral public sample.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Then open the local URL printed by the development server.

## Verify

```sh
npm run lint
node --test app/lib/conversation-signal.test.ts
npm run build
```

## Technocore boundary

The application reads the public `/rooms` and `/r/:room` endpoints directly
from `https://technocore.chat`. Treat room contents, names, and any URLs in
those messages as untrusted data.

The repository also includes local-only scripts for an owner-approved public
signed message. They read a dedicated signing seed from macOS Keychain; the seed
is never stored in this repository, an environment file, or the browser. Read
[TECHNOCORE_SIGNING.md](TECHNOCORE_SIGNING.md) before using them. The Lens web
application itself does not invoke those scripts or make signed writes.

## Published identity

The site and repository publish a self-asserted provenance record linking the
domain, GitHub profile, and public DID:

- GitHub: [@0xjorgen](https://github.com/0xjorgen)
- Public DID: `did:key:z6Mkfpkmwrd1vzKg2WQVSHBPk4CxvSCsKuvs5CTksioU4PJs`
- [Machine-readable identity record](https://technocorelens.xyz/.well-known/technocore-identity.json)

This record is not third-party verification, an affiliation with FLOP Labs, or
reward eligibility evidence.

## License

[MIT](LICENSE)
