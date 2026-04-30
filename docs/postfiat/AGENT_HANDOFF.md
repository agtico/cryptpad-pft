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
- `config/config.example.js`, `lib/env.js`, and `lib/http-worker.js`: public `postFiat.walletFirst` and `postFiat.disableLegacyLogin` config exposed through `/api/config`.
- `customize.dist/pages/login.js` and `www/login/main.js`: wallet-first login surface with 24-word seed phrase login, encrypted saved-wallet unlock, and legacy username/password login behind a compatibility button by default.
- `scripts/tests/postfiat-*.test.*`: focused unit tests for wallet derivation, signing, entropy derivation, PFT channel bytes, and wallet session storage.

## Do Not Re-Discover These First

Use these local repos as references:

```text
/home/pfrpc/repos/pfdapp/cryptpad
/home/pfrpc/repos/pfdapp/docs/WALLET_DOCUMENT_SHARING_AND_OWNERSHIP.md
/home/pfrpc/repos/pftasks/app/src/lib/wallet
/home/pfrpc/repos/pftasks/app/src/lib/pftl/transactions.js
/home/pfrpc/repos/sprs/app/production_app.py
/home/pfrpc/repos/sprs/app/services/auth.py
/home/pfrpc/repos/sprs/app/services/cryptpad_escrow.py
```

## Recommended Implementation Order

1. Add wallet creation/onboarding with a save-confirm step.
2. Add browser e2e coverage for wallet-first login, seed login, saved-wallet unlock, session lock, and drive recovery.
3. Add proper in-session mnemonic/key handling for PFTL sharing operations.
4. Port PFTL key lookup/publication.
5. Add share-to-wallet bridge for CryptPad URL secrets.
6. Only then start native PFTL document integration and broad UI redesign.

## Key Technical Decisions Already Made

- Primary login identity is the XRPL classic wallet address.
- Primary wallet UX is Task Node 24-word seed phrase.
- Username/password login is legacy compatibility. Keep it hidden by default, and only hard-disable it with `postFiat.disableLegacyLogin` after account migration is solved.
- MetaMask Snap support is optional, not the only path.
- Canonical share model is PFTL v3 ContentBlob/AccessManifest plus XRPL pointer memo.
- Raw CryptPad URL sharing should be legacy/advanced, not the main PFT UX.
- Revocation requires file-key/content rotation.
- Wallet login should not leave a persistent CryptPad `Block_hash` in `localStorage`; it should unlock the current browser session only.
- Manually opened new tabs should not silently borrow the active wallet session. If explicit cross-tab unlock is added later, it must be user-initiated.
- Saved wallet vaults are encrypted locally with PBKDF2-SHA256/AES-GCM; the vault unlock password is not a CryptPad password.

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
- Share a live pad to a second wallet through a PFTL encrypted payload.
- Recipient decrypts the pointer payload and opens/imports the pad.
