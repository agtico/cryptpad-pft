# Agent Handoff

## Current Repo

Local path:

```text
/home/pfrpc/repos/cryptpad-pft
```

Upstream base:

```text
9004ad2dd1b40d571b25f66dfe968606233f51a8
```

The fork now contains upstream CryptPad plus Post Fiat planning docs and the first wallet-login foundation.

Implemented so far:

- `src/postfiat/wallet-core.mjs`: Task Node style 24-word BIP39 mnemonic, XRPL wallet derivation, and message signing/verification.
- `src/postfiat/wallet-core.mjs`: encrypted saved-wallet vault helpers using PBKDF2-SHA256 and AES-GCM.
- `src/common/postfiat-wallet-auth.js`: canonical Post Fiat login/access messages plus wallet-signature-to-CryptPad-entropy derivation.
- `www/common/common-login.js`: accepts `walletAuth` without breaking stock password login, uses wallet-derived entropy, preserves wallet address casing, and makes wallet login idempotent.
- `www/common/outer/local-store.js`: wallet logins store CryptPad login capabilities in `sessionStorage` only, ignore stale persisted wallet-looking `Block_hash` values, and expose `BroadcastChannel` helpers for future explicit cross-tab unlock.
- `www/drive/main.js` and `www/login/main.js`: do not silently import an active wallet session; new tabs must unlock explicitly unless an explicit UI is added later.
- `www/common/postfiat-wallet-core.bundle.js`: browser bundle for mnemonic derivation and message signing.
- `config/config.example.js`, `lib/env.js`, and `lib/http-worker.js`: public `postFiat.walletFirst`, `postFiat.disableLegacyLogin`, `postFiat.pftl`, and `postFiat.nostr` config exposed through `/api/config`.
- `customize.dist/pages/login.js` and `www/login/main.js`: wallet-first login surface with generated 24-word wallet creation, seed phrase restore, encrypted saved-wallet unlock, and legacy username/password login behind a compatibility button by default.
- `src/postfiat/wallet-core.mjs`: session-only encrypted mnemonic handoff using a non-extractable AES-GCM key in IndexedDB plus encrypted material in `sessionStorage`.
- `src/postfiat/key-registry.mjs`: recipient X25519 key parsing with Task Node `MessageKey` preferred over legacy Domain `x25519:`, plus an AccountSet transaction shape helper for MessageKey publication.
- `src/postfiat/nostr-identity.mjs`: PFT wallet-signature-derived Nostr keypair and wallet -> Nostr pubkey -> relay directory record helpers.
- `src/postfiat/live-pad-share.mjs`: canonical plaintext envelope for packaging live CryptPad pad capabilities before encrypted Nostr delivery, plus explicit durable PFTL envelope plumbing.
- `src/postfiat/nostr-private-share.mjs`: NIP-44 v2 encryption/decryption, NIP-01 event signing/verification, and NIP-59-style seal/gift-wrap helpers for private live-pad shares.
- `src/postfiat/nostr-relay-client.mjs`: relay WebSocket helpers for publishing gift wraps and fetching recipient inbox gift wraps.
- `scripts/tests/postfiat-*.test.*`: focused unit tests for wallet derivation, signing, entropy derivation, PFT channel bytes, wallet session storage, key registry parsing, Nostr identity/directory records, NIP-44/NIP-59 wrapping, relay publish/fetch helpers, and live-pad share payloads.

Architecture pivot to preserve privacy:

- PFT remains the identity, entitlement, recovery, and payment layer.
- Nostr-style encrypted relay delivery should be the default document share/chat transport.
- PFTL/IPFS should be an explicit durable publication/export path, not normal sharing.
- Future Orchard/shielded PFTL work protects transaction metadata but does not by itself hide IPFS CIDs, pinning providers, gateway access, or durable pointer existence.

## Do Not Re-Discover These First

Use these local repos as references:

```text
/home/pfrpc/repos/pfdapp/cryptpad
/home/pfrpc/repos/pfdapp/docs/WALLET_DOCUMENT_SHARING_AND_OWNERSHIP.md
/home/pfrpc/repos/pftasks/app/src/lib/wallet
/home/pfrpc/repos/pftasks/app/src/lib/pftl/transactions.js
/home/pfrpc/repos/pftasks/app/src/lib/pftl/wss.js
/home/pfrpc/repos/sprs/app/production_app.py
/home/pfrpc/repos/sprs/app/services/auth.py
/home/pfrpc/repos/sprs/app/services/cryptpad_escrow.py
```

## Recommended Implementation Order

1. Add browser e2e coverage for wallet-first login, seed login, saved-wallet unlock, session lock, and drive recovery.
2. Wire `src/postfiat/live-pad-share.mjs` and `src/postfiat/nostr-private-share.mjs` into a real share-to-wallet modal.
3. Connect `src/postfiat/nostr-relay-client.mjs` to configured PFT/user relays in the browser.
4. Build the private "Shared with me" Nostr inbox before any on-chain/IPFS pointer inbox.
5. Keep PFTL/IPFS durable publishing behind explicit UX and privacy warnings.

## Key Technical Decisions Already Made

- Primary login identity is the XRPL classic wallet address.
- Primary wallet UX is Task Node 24-word seed phrase.
- Username/password login is legacy compatibility. Keep it hidden by default, and only hard-disable it with `postFiat.disableLegacyLogin` after account migration is solved.
- MetaMask/PFTL Snap support is de-scoped from MVP. Treat external wallet providers as later adapters after Task Node seed login and Nostr private sharing are solid.
- Canonical private share model is encrypted Nostr relay delivery of live-pad capability payloads.
- Durable/publication share model is PFTL v3 ContentBlob/AccessManifest plus XRPL pointer memo, used only when the user explicitly chooses durable publication/export.
- Raw CryptPad URL sharing should be legacy/advanced, not the main PFT UX.
- IPFS/PFTL should not be the silent default because CIDs, pinning providers, gateways, timing, and retention can create a document activity trail even if payments are shielded.
- Revocation requires file-key/content rotation.
- Wallet login should not leave a persistent CryptPad `Block_hash` in `localStorage`; it should unlock the current browser session only.
- Manually opened new tabs should not silently borrow the active wallet session. If explicit cross-tab unlock is added later, it must be user-initiated.
- Saved wallet vaults are encrypted locally with PBKDF2-SHA256/AES-GCM; the vault unlock password is not a CryptPad password.
- Nostr relay privacy is not perfect: relays can observe IPs, timing, relay choices, event sizes, and retention. Support PFT-operated private relays, user relay overrides, and eventually proxy/Tor-friendly relay access.

## Known Traps

- The previous PFT CryptPad prototype has debug logging in login paths. Remove it when porting.
- Previous theme injection used repeated timeouts because CryptPad LESS loaded after custom CSS. Replace this with a cleaner load-order solution if possible.
- `sprs/app/services/auth.py` warns its DB-backed SQL path uses string interpolation and needs parameterization before activation.
- `sprs` CryptPad escrow is centralized and seed-unlock dependent; use it only as a reference/migration path, not the canonical open-source sharing model.
- `tasknode-wallet` uses XRPL family seeds today; use `pftasks/app/src/lib/wallet` for the current 24-word mnemonic implementation.
- `pftasks` encrypted-wallet localStorage backup should be security-reviewed before copying.
- Stock CryptPad treats `Block_hash` as the login capability. Do not persist wallet-derived `Block_hash` outside the current session.

## Smoke Test Targets For The First Implementation PR

- Create a 24-word wallet.
- Lock and unlock it.
- Derive the same wallet address after restore.
- Sign the canonical login message.
- Login/register into CryptPad with wallet-derived account material.
- Reload the browser and recover the same drive.
- Open a new same-origin `/drive/` tab while the first wallet tab is still unlocked and confirm it does not silently unlock.
- Share a live pad to a second wallet through encrypted Nostr relay delivery.
- Recipient decrypts the private inbox payload and opens/imports the pad.
- Durable PFTL/IPFS publication remains an explicit advanced flow with privacy warnings.
