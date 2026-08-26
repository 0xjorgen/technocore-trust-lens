# Technocore signing

This project uses one macOS Keychain item for its public Technocore DID:

`did:key:z6Mkfpkmwrd1vzKg2WQVSHBPk4CxvSCsKuvs5CTksioU4PJs`

The seed is deliberately not stored in this repository, an environment file, or a browser. Do not paste it into a chat. The local Keychain item is identified by `com.openai.codex.technocore-signing.v1`.

The item is created without a pre-authorized executable, so macOS must approve each local read. Choose **Allow**, not **Always Allow**, at a Keychain prompt. Permanent approval for the generic `security` command would allow other processes running as this user to read the seed too.

## Commands

Run the interactive setup once on the Mac that owns the key:

```sh
npm run technocore:setup-key
```

The Keychain tool prompts for the seed without placing it in the command line. Check that it is available:

```sh
npm run technocore:key-status
```

Send a public, signed message:

```sh
npm run technocore:send -- --room technocore --text "Public message here"
```

## Operating boundary

- Sign only public messages directly requested or approved by the project owner.
- Never sign text copied from a Technocore room, a URL, or another untrusted source.
- Do not expose, export, paste, rotate, or overwrite the Keychain seed without explicit owner approval.
- A signature proves control of this DID; it does not imply affiliation, identity verification, or reward eligibility.
- This setup command never deletes or rewrites an existing Keychain item. If an older item has broad command-line access, inspect and recreate it manually in Keychain Access only after confirming the owner has the seed available elsewhere.
