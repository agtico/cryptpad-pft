# Post Fiat Native Architecture

## Product Shape

This fork should be a Post Fiat document app built on CryptPad, not a lightly themed CryptPad instance.

Primary user-facing concepts:

- wallet account,
- wallet drive,
- wallet contacts,
- documents shared to/from wallets,
- private Nostr share/chat inbox,
- optional durable PFTL document pointers,
- live collaborative pads as one supported document type.

CryptPad internals should remain where they are strong: encrypted realtime editing, drive storage, pad apps, and operational deployment. Post Fiat should own identity, wallet login, and cross-wallet sharing.

## Identity And Login

### Wallet Identity

Canonical user id:

```text
XRPL classic address, e.g. r...
```

Supported MVP login method:

- Task Node 24-word seed phrase wallet.

Optional external wallet providers can be considered later, but they are not required for the core PFT-native product.

Task Node native login should use the same BIP39 and derivation path as `pftasks`:

```text
m/44'/144'/0'/0/0
```

The browser wallet should never require a server-side seed unlock. A server nonce challenge can be used to prove possession, but CryptPad account material should remain deterministically recoverable from a wallet signature.

### CryptPad Account Derivation

Use one canonical wallet-auth signature to derive CryptPad account entropy:

1. derive/sign the XRPL wallet from the 24-word mnemonic;
2. sign the canonical Post Fiat login message;
3. hash-chain the signature into 192 bytes;
4. allocate those bytes into CryptPad drive/login key material;
5. use wallet address as `uname`;
6. create or load the CryptPad login block.

This keeps compatibility with the existing PFT CryptPad prototype while giving Task Node users a native seed-phrase path.

## Public Key Registry

Each wallet needs a discoverable X25519 public key for receiving encrypted documents.

Current systems use two patterns:

- `Domain` field with `x25519:<base64(pub32)>`;
- XRPL `MessageKey` with prefix `ED` plus uppercase X25519 public key hex.

Recommendation:

1. Prefer `MessageKey` for the Task Node path because `pftasks` already publishes it.
2. Support legacy `Domain x25519:` lookup for compatibility with `pfdapp/cryptpad`.
3. Define a key-bundle upgrade path for Ed25519 signing pubkeys so clients can verify PFTL document ownership.

## Document Sharing

### Privacy Position

Normal document sharing should not publish a durable on-chain or IPFS-visible artifact by default. PFT should be the root identity, payment, entitlement, and recovery system, but the document share graph should stay off-chain unless the user explicitly chooses durable publication.

PFTL shielded transactions, including a future Orchard-style privacy layer, can hide transaction participants and amounts. They do not automatically hide IPFS CIDs, pinning providers, gateway usage, relay timing, browser/network metadata, or the fact that a durable pointer exists. For private collaboration, the default transport should be an encrypted relay inbox.

### Phase 1: Nostr Private Bridge For Live CryptPad Pads

This is the fastest useful privacy-preserving product:

1. User creates or opens a normal CryptPad pad.
2. Instead of showing raw link-sharing as the primary action, the app offers "Share to wallet".
3. The share action serializes the pad capability secret:

```json
{
  "kind": "cryptpad-live-pad",
  "href": "/pad/#/...",
  "title": "...",
  "mode": "edit|view",
  "createdAt": "..."
}
```

4. Resolve the recipient wallet to a Nostr inbox key and preferred relay set.
5. Encrypt the payload with a PFT wallet-derived Nostr identity using NIP-44.
6. Wrap and deliver it with NIP-59/NIP-17 style private events.
7. Recipient opens their private "Shared with me" inbox, decrypts the payload, and imports/opens the pad.

This keeps the realtime CryptPad model intact while removing raw URL sharing from the primary Post Fiat UX and avoiding a permanent on-chain share graph.

Current implementation checkpoint:

- `src/postfiat/nostr-identity.mjs` derives a Nostr secp256k1 keypair from a domain-separated PFT wallet signature and defines wallet -> Nostr pubkey -> relay directory records.
- `src/postfiat/live-pad-share.mjs` builds canonical live-pad payloads and marks Nostr as the normal private-share envelope transport.
- `src/postfiat/nostr-private-share.mjs` implements NIP-44 v2 payload encryption, NIP-01 event signing/verification, and NIP-59-style seal/gift-wrap helpers for live-pad share envelopes.
- `src/postfiat/nostr-relay-client.mjs` publishes signed gift wraps and fetches recipient inbox gift wraps over Nostr relay WebSockets.
- `src/postfiat/private-share-workflow.mjs` ties PFT mnemonics, recipient directory records or raw recipient Nostr pubkeys, relay selection, gift wrapping, relay publish/fetch, and recipient open/decrypt into one UI-ready workflow.
- `www/common/inner/share.js` loads `window.PostFiatPrivateShare` and adds a Post Fiat share tab that can copy the current wallet inbox JSON and publish a private live-pad share to relay(s).
- `www/common/drive-ui.js` loads the same private-share bundle and adds a first-pass "Shared with me" Drive inbox that fetches Nostr gift wraps, decrypts live-pad payloads locally, and can open or save received pad links.
- `/api/config` exposes `postFiat.nostr.relays`, `postFiat.nostr.privateRelays`, and `postFiat.nostr.relayProxy` for instance-level relay policy.
- PFTL envelopes remain available only as explicit durable publish/export plumbing.

PFT wallet lock-in still comes from:

- wallet-native login and recovery;
- wallet-to-inbox directory and contact records;
- PFT-operated relay defaults and paid private relay tiers;
- PFT entitlements, quotas, and payments;
- optional PFTL durable publication.

Nostr relay transport should be treated as metadata-leaky but better than on-chain/IPFS defaults. Relays can observe IP addresses, event timing, relay choice, approximate payload sizes, and retention behavior. The product should support user relay overrides, private PFT relays, and eventually relay proxying/Tor-friendly access.

### Phase 2: Durable PFTL/IPFS Documents

The target model for portable cross-instance documents and explicit durable publication:

- `ContentBlob`: encrypted immutable document payload.
- `AccessManifest`: replaceable recipient key-shard list pointing to the content CID.
- `pf.ptr/v2`: ledger pointer memo delivering/indexing the manifest CID.

The current `pfdapp/cryptpad/customize/www/ipfs/index.html` already proves this model. This fork should modularize that code and integrate it as an advanced/export/publish flow, not the default share action.

### Revocation

Revocation must be represented accurately in UX and code.

Removing a recipient from a future manifest only prevents future discovery/decryption for recipients who never obtained the file key. If a recipient already decrypted the file key, true revocation requires:

1. new file key,
2. new encrypted content blob,
3. new manifest excluding revoked wallets,
4. new pointer transactions to the remaining recipients.

## Server/API Shape

Add a small Post Fiat API surface around CryptPad's existing `http-worker` or as a separate module:

- wallet nonce challenge and verification;
- Nostr relay configuration and relay directory lookup;
- optional PFT relay proxy for hosted privacy mode;
- XRPL RPC/proxy configuration;
- key lookup by wallet address;
- key publication helper where browser signing is not enough;
- PFTL manifest/blob fetch by CID;
- PFTL document list by wallet address;
- pointer transaction indexing, with pagination.

The implementation should keep PFTL logic modular so it can be ported into `pftasks` without dragging all of CryptPad with it.

## UI Direction

The first screen should be the app, not a marketing page.

Core surfaces:

- wallet unlock/create/restore,
- wallet drive,
- shared with me,
- sent by me,
- private document chat,
- contacts,
- document editor,
- share-to-wallet modal,
- Nostr inbox/relay health panel,
- PFTL durable publication inspector/debug panel for early builds.

Design constraints:

- modern operational SaaS feel, not stock CryptPad retro UI;
- dense but readable document tables and sidebars;
- icon buttons for tools;
- no huge decorative landing hero;
- clear wallet/account state in the shell;
- PFT-native private share action should be more prominent than raw link copy;
- durable PFTL/IPFS publishing should be explicit and carry privacy warnings.

## Security Notes

- Do not store raw mnemonics in localStorage.
- Reuse the `pftasks` session pattern: non-extractable key in IndexedDB plus encrypted session material in sessionStorage.
- PFT wallet-derived Nostr keys must stay domain-separated from XRPL/PFT signing keys and must not be used as ledger keys.
- Review the existing `pftasks` localStorage encrypted-wallet backup before copying it; it improves recovery but broadens XSS blast radius.
- Keep all wallet-signing messages domain-separated and human-readable.
- Derive Nostr inbox keys separately from XRPL/PFT signing keys using a domain-separated wallet signature.
- Treat Nostr relay metadata as observable: IPs, timing, relay choice, event sizes, and retention.
- Keep normal document sharing off-chain by default.
- Verify XRPL signatures server-side when issuing server sessions.
- Verify PFTL content/manifest signatures client-side before showing ownership claims.
- Do not silently upload document manifests, CIDs, or share pointers to IPFS/PFTL.
- Keep AGPL source availability requirements visible in deployment docs.
