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
- `src/common/postfiat-wallet-auth.js`: canonical Post Fiat login/access messages plus wallet-signature-to-CryptPad-entropy derivation.
- `www/common/common-login.js`: accepts `walletAuth` without breaking stock password login, uses wallet-derived entropy, preserves wallet address casing, and makes wallet login idempotent.
- `www/common/outer/local-store.js`: wallet logins store CryptPad login capabilities in `sessionStorage` only and ignore stale persisted wallet-looking `Block_hash` values.
- `www/common/postfiat-wallet-core.bundle.js`: browser bundle for mnemonic derivation and message signing.
- `customize.dist/pages/login.js` and `www/login/main.js`: minimal 24-word seed phrase login form wired into `walletAuth`.
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

1. Add encrypted wallet-at-rest storage and session restore.
2. Add wallet creation/onboarding with a save-confirm step.
3. Add browser e2e coverage for wallet unlock, session lock, and drive recovery.
4. Port PFTL key lookup/publication.
5. Add share-to-wallet bridge for CryptPad URL secrets.
6. Only then start native PFTL document integration and broad UI redesign.

## Key Technical Decisions Already Made

- Primary login identity is the XRPL classic wallet address.
- Primary wallet UX is Task Node 24-word seed phrase.
- MetaMask Snap support is optional, not the only path.
- Canonical share model is PFTL v3 ContentBlob/AccessManifest plus XRPL pointer memo.
- Raw CryptPad URL sharing should be legacy/advanced, not the main PFT UX.
- Revocation requires file-key/content rotation.
- Wallet login should not leave a persistent CryptPad `Block_hash` in `localStorage`; it should unlock the current browser session only.

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
- Share a live pad to a second wallet through a PFTL encrypted payload.
- Recipient decrypts the pointer payload and opens/imports the pad.
