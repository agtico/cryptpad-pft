# Post Fiat CryptPad Burndown

Status values:

- `[x]` done in this fork
- `[~]` partially done elsewhere in local repos; needs porting
- `[ ]` not done

## Phase 0: Repository And Research

- [x] Pull a clean upstream CryptPad base.
- [x] Preserve upstream remote as `upstream`.
- [x] Inspect existing PFT CryptPad customizations in `pfdapp/cryptpad`.
- [x] Inspect SPRS wallet nonce/session/token logic.
- [x] Inspect Task Node 24-word seed phrase wallet logic.
- [x] Capture architecture recommendation.
- [x] Capture implementation burndown and handoff notes.
- [x] Create GitHub repo under `agtico`.
- [x] Push initial fork and docs.

## Phase 1: Wallet Core

- [~] Port Task Node BIP39 wallet primitives into this fork as a browser module.
- [x] Use `@scure/bip39` and XRPL `Wallet.fromMnemonic` with path `m/44'/144'/0'/0/0`.
- [x] Implement create wallet, restore wallet, unlock wallet, lock wallet.
- [x] Store encrypted wallet payload with PBKDF2-SHA256/AES-GCM.
- [x] Keep wallet-derived CryptPad login capabilities in session storage only.
- [x] Use encrypted session-only unlocked mnemonic handling patterned after `pftasks/app/src/lib/wallet/session.js`.
- [x] Add wallet signing helper for canonical Post Fiat login/access messages.
- [ ] Consider optional external wallet providers after the Task Node seed path and Nostr sharing are complete.
- [x] Add tests for mnemonic normalization, derivation path, address derivation, and signature verification.

## Phase 2: Wallet Login Into CryptPad

- [x] Port existing `walletAuth` derivation from `pfdapp/cryptpad/www/common/common-login.js`.
- [x] Remove debug logging from the old prototype before porting.
- [x] Standardize one canonical login signing message.
- [x] Derive the 192-byte CryptPad login entropy from wallet signature.
- [x] Use wallet address as the CryptPad username.
- [x] Make wallet login idempotent: first use registers, later use logs in.
- [x] Prevent stale persisted wallet `Block_hash` values from silently auto-unlocking.
- [x] Add wallet-session import/export helpers for future explicit cross-tab unlock without persisting the login capability.
- [x] Keep `/drive/` and `/login/` from silently importing active wallet sessions by default.
- [x] Add public `postFiat.walletFirst` and `postFiat.disableLegacyLogin` instance config.
- [x] Move legacy username/password login behind an explicit compatibility button by default.
- [ ] Decide migration behavior for old username/password users.
- [x] Add wallet-login UI for create/restore/unlock.
- [x] Add saved-wallet unlock path that avoids repeated seed paste.
- [ ] Add server nonce session only where server authorization is needed.
- [ ] Add e2e test: restore same 24-word seed in a new browser and recover same CryptPad drive.

## Phase 3: PFTL Key Registry

- [~] Reuse existing Domain `x25519:` lookup from `pfdapp/cryptpad`.
- [~] Reuse Task Node `MessageKey` publication from `pftasks`.
- [x] Implement key lookup order: MessageKey first, Domain fallback second.
- [~] Implement publish/update X25519 public key for Task Node wallet users.
- [ ] Define key bundle format for future Ed25519 signing-key verification.
- [x] Add tests for recipient id derivation and key lookup failures.

## Phase 4: Nostr Private Sharing Bridge For Live CryptPad Pads

- [x] Derive a Nostr inbox identity from the PFT wallet using a domain-separated wallet signature.
- [x] Define a PFT wallet directory record: wallet address -> Nostr public key -> preferred relay set.
- [x] Add Nostr relay config, including PFT-operated default relays and user/private relay overrides.
- [x] Package pad capability secrets as a canonical live-pad share payload.
- [x] Encrypt live-pad share payloads with NIP-44 and wrap/deliver them with NIP-59/NIP-17 style private events.
- [~] Add "Share to wallet" as the primary share action in the CryptPad share modal.
- [~] Add "Shared with me" inbox based on encrypted Nostr relay messages, not on-chain pointer scans.
- [~] Let recipient import/open a received live pad from the private inbox.
- [x] Add UI-ready workflow helpers that publish and open live-pad private shares from PFT wallet mnemonics.
- [x] Bundle the private-share workflow for browser use.
- [x] Let the browser share workflow accept a recipient Nostr pubkey plus relay list before full wallet-directory discovery exists.
- [x] Add Nostr relay wallet-directory publish/fetch so first exchange can target a PFT wallet address without raw pubkey or inbox JSON paste.
- [~] Add encrypted-account saved recipients so users can reuse private-share contacts after first exchange.
- [ ] Add peer chat/replies around shared documents using the same encrypted relay channel.
- [ ] Keep raw CryptPad link copy available as an advanced/legacy action.
- [ ] Add e2e test: wallet A creates pad, shares privately to wallet B via Nostr relay, wallet B opens it.

## Phase 5: Durable PFTL/IPFS Publishing

- [~] Existing `/ipfs/` viewer in `pfdapp/cryptpad` decrypts and shares PFTL v3 docs.
- [ ] Treat IPFS/PFTL as explicit durable/export/publication mode, not default sharing.
- [ ] Extract the viewer's crypto/IPFS/XRPL code into modules.
- [ ] Integrate PFTL docs into main drive UI.
- [ ] Support document creation as PFTL `ContentBlob`.
- [ ] Support manifest update for adding recipients.
- [ ] Support key/content rotation for practical revocation.
- [ ] Show owner wallet, shared-by wallet, recipient wallet, and manifest CID.
- [ ] Verify content and manifest signatures before showing strong ownership claims.
- [ ] If Orchard/shielded PFTL is added, keep document CIDs/manifests/pinning metadata out of the shielded transaction path unless the user explicitly opts in.
- [ ] Label durable publication with clear privacy warnings about observable CIDs, pinning providers, gateways, timing, and retention.
- [ ] Add tests for decrypt, share, rotate, and corrupted manifest/blob handling.

## Phase 6: UI Redesign

- [ ] Build a Post Fiat shell around CryptPad apps.
- [~] Replace stock landing/login surfaces with wallet-first flows.
- [ ] Replace drive styling with a modern document workspace.
- [ ] Add wallet account panel, balance/network state, and key publication state.
- [~] Add wallet contacts/address book.
- [~] Add PFT-native share modal.
- [ ] Review mobile layout for drive, editor, wallet unlock, and share flows.
- [ ] Remove fragile repeated CSS timeout injection from previous prototypes.
- [ ] Add screenshot regression checks for desktop and mobile.

## Phase 7: Server And Deployment

- [ ] Decide whether Post Fiat APIs live in `lib/http-worker.js` or a separate module.
- [~] Add environment config for Nostr relays, relay discovery, relay retention, and optional PFT-operated private relay defaults.
- [~] Add environment config for PFTL RPC/WSS, network id, IPFS gateway, and pinning backend.
- [ ] Add optional Nostr relay proxy for privacy-preserving relay access from hosted instances.
- [ ] Add wallet nonce verification endpoint for server sessions.
- [ ] Add PFTL pointer list endpoint with pagination.
- [ ] Add manifest/blob fetch endpoints preserving signatures.
- [x] Add Docker compose example for standalone open-source instance.
- [x] Document AGPL source distribution obligations.

## Phase 8: Security Review

- [ ] Threat model mnemonic handling, wallet signatures, XSS, and malicious documents.
- [~] Confirm all signing messages are domain-separated.
- [ ] Threat model Nostr relay metadata: IPs, timing, relay choice, event sizes, retention, and replay.
- [x] Ensure PFT wallet-derived Nostr keys are separate from XRPL/PFT signing keys and domain-separated.
- [ ] Remove raw mnemonic/localStorage usage from final runtime paths.
- [ ] Review CSP and sandboxing around editors and custom wallet scripts.
- [ ] Verify XRPL transaction construction and network IDs.
- [ ] Verify IPFS/PFTL publication is never the silent default for normal document sharing.
- [ ] Verify revocation language in UI is accurate.
- [ ] Review legacy CryptPad raw URL sharing for accidental primary exposure.

## Phase 9: Portability To `pftasks`

- [ ] Keep wallet modules compatible with `pftasks` imports.
- [ ] Keep PFTL document modules framework-agnostic where possible.
- [ ] Define a minimal shared package boundary for wallet, key registry, PFTL docs, and pointer APIs.
- [ ] Add a demo route or adapter proving a PFTL document can be opened from `pftasks`.

## Immediate Next Tasks

1. Add browser e2e tests for wallet-first login, saved-wallet unlock, session lock, no silent cross-tab unlock, and drive recovery.
2. Add browser-level integration tests against a local or fake Nostr relay for share publish, inbox refresh, open, and save.
3. Add browser e2e coverage for wallet-directory publish/fetch and share-by-wallet-address.
4. Improve the first-pass Post Fiat share/inbox UI styling and mobile layout.
5. Keep PFTL/IPFS work behind explicit durable-publish UX and privacy warnings.
