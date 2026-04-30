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

No application code has been modified yet. The fork currently contains upstream CryptPad plus Post Fiat planning docs.

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

1. Create a `customize/www/postfiat/` area for wallet modules and UI glue.
2. Port Task Node wallet derivation/session code first.
3. Port the existing `walletAuth` CryptPad login changes from `pfdapp/cryptpad/www/common/common-login.js`.
4. Make wallet login work before touching sharing.
5. Port PFTL key lookup/publication.
6. Add share-to-wallet bridge for CryptPad URL secrets.
7. Only then start native PFTL document integration and broad UI redesign.

## Key Technical Decisions Already Made

- Primary login identity is the XRPL classic wallet address.
- Primary wallet UX is Task Node 24-word seed phrase.
- MetaMask Snap support is optional, not the only path.
- Canonical share model is PFTL v3 ContentBlob/AccessManifest plus XRPL pointer memo.
- Raw CryptPad URL sharing should be legacy/advanced, not the main PFT UX.
- Revocation requires file-key/content rotation.

## Known Traps

- The previous PFT CryptPad prototype has debug logging in login paths. Remove it when porting.
- Previous theme injection used repeated timeouts because CryptPad LESS loaded after custom CSS. Replace this with a cleaner load-order solution if possible.
- `sprs/app/services/auth.py` warns its DB-backed SQL path uses string interpolation and needs parameterization before activation.
- `sprs` CryptPad escrow is centralized and seed-unlock dependent; use it only as a reference/migration path, not the canonical open-source sharing model.
- `tasknode-wallet` uses XRPL family seeds today; use `pftasks/app/src/lib/wallet` for the current 24-word mnemonic implementation.
- `pftasks` encrypted-wallet localStorage backup should be security-reviewed before copying.

## Smoke Test Targets For The First Implementation PR

- Create a 24-word wallet.
- Lock and unlock it.
- Derive the same wallet address after restore.
- Sign the canonical login message.
- Login/register into CryptPad with wallet-derived account material.
- Reload the browser and recover the same drive.
- Share a live pad to a second wallet through a PFTL encrypted payload.
- Recipient decrypts the pointer payload and opens/imports the pad.
