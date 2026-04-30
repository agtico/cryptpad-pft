# CryptPad PFT Fork

This repository is a Post Fiat native fork of upstream CryptPad.

Base upstream:

- Repository: `https://github.com/cryptpad/cryptpad`
- Imported commit: `9004ad2dd1b40d571b25f66dfe968606233f51a8`
- License inherited from CryptPad: AGPL-3.0-or-later

## Goal

Build a modern, open-source CryptPad distribution that:

- uses Post Fiat wallet identity as the login identity,
- supports Task Node style 24-word seed phrase wallets,
- optionally supports the existing MetaMask PFTL Snap flow,
- makes document sharing wallet-native through PFTL/XRPL logic,
- can later be ported into `pftasks` or run as a standalone instance,
- ships with a substantially better branded UI than stock CryptPad.

## Current State

The fork now includes the first Post Fiat wallet login path:

- Task Node style 24-word BIP39/XRPL wallet derivation.
- Canonical Post Fiat login message signing.
- Deterministic CryptPad account derivation from the wallet signature.
- Minimal wallet login UI.
- Session-only wallet login capability storage so a wallet login does not leave a persistent CryptPad `Block_hash` in browser `localStorage`.

Read these first:

- `docs/postfiat/RESEARCH.md`
- `docs/postfiat/ARCHITECTURE.md`
- `docs/postfiat/BURNDOWN.md`
- `docs/postfiat/AGENT_HANDOFF.md`

## Key Recommendation

Do not make CryptPad contacts or raw share URLs the canonical Post Fiat access model.

The fastest useful bridge is to encrypt CryptPad pad secrets/URLs as PFTL v3 payloads and send wallet-to-wallet pointer transactions. The longer-term target is PFTL v3 document storage: encrypted `ContentBlob`, replaceable `AccessManifest`, and XRPL `pf.ptr/v2` pointer memos.
