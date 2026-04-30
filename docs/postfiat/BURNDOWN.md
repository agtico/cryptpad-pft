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

- [ ] Port Task Node BIP39 wallet primitives into this fork as a browser module.
- [ ] Use `@scure/bip39` and XRPL `Wallet.fromMnemonic` with path `m/44'/144'/0'/0/0`.
- [ ] Implement create wallet, restore wallet, unlock wallet, lock wallet.
- [ ] Store encrypted wallet payload with PBKDF2-SHA256/AES-GCM or a reviewed stronger KDF.
- [ ] Use session-only unlocked mnemonic handling patterned after `pftasks/app/src/lib/wallet/session.js`.
- [ ] Add wallet signing helper for canonical Post Fiat login/access messages.
- [ ] Add MetaMask PFTL Snap support as an optional wallet provider.
- [ ] Add tests for mnemonic normalization, derivation path, address derivation, and signature verification.

## Phase 2: Wallet Login Into CryptPad

- [~] Port existing `walletAuth` derivation from `pfdapp/cryptpad/www/common/common-login.js`.
- [ ] Remove debug logging from the old prototype before porting.
- [ ] Standardize one canonical login signing message.
- [ ] Derive the 192-byte CryptPad login entropy from wallet signature.
- [ ] Use wallet address as the CryptPad username.
- [ ] Make wallet login idempotent: first use registers, later use logs in.
- [ ] Decide migration behavior for old username/password users.
- [ ] Add wallet-login UI for create/restore/unlock.
- [ ] Add server nonce session only where server authorization is needed.
- [ ] Add e2e test: restore same 24-word seed in a new browser and recover same CryptPad drive.

## Phase 3: PFTL Key Registry

- [~] Reuse existing Domain `x25519:` lookup from `pfdapp/cryptpad`.
- [~] Reuse Task Node `MessageKey` publication from `pftasks`.
- [ ] Implement key lookup order: MessageKey first, Domain fallback second.
- [ ] Implement publish/update X25519 public key for Task Node wallet users.
- [ ] Define key bundle format for future Ed25519 signing-key verification.
- [ ] Add tests for recipient id derivation and key lookup failures.

## Phase 4: PFTL Sharing Bridge For Live CryptPad Pads

- [ ] Add "Share to wallet" as the primary share action in the CryptPad share modal.
- [ ] Package pad capability secrets as encrypted PFTL v3 payloads.
- [ ] Publish encrypted content blob and access manifest.
- [ ] Send `pf.ptr/v2` pointer memo to recipient wallet.
- [ ] Add "Shared with me" inbox based on pointer transaction list.
- [ ] Let recipient import/open a received live pad.
- [ ] Keep raw link copy available as an advanced/legacy action.
- [ ] Add e2e test: wallet A creates pad, shares to wallet B, wallet B opens it.

## Phase 5: Native PFTL Documents

- [~] Existing `/ipfs/` viewer in `pfdapp/cryptpad` decrypts and shares PFTL v3 docs.
- [ ] Extract the viewer's crypto/IPFS/XRPL code into modules.
- [ ] Integrate PFTL docs into main drive UI.
- [ ] Support document creation as PFTL `ContentBlob`.
- [ ] Support manifest update for adding recipients.
- [ ] Support key/content rotation for practical revocation.
- [ ] Show owner wallet, shared-by wallet, recipient wallet, and manifest CID.
- [ ] Verify content and manifest signatures before showing strong ownership claims.
- [ ] Add tests for decrypt, share, rotate, and corrupted manifest/blob handling.

## Phase 6: UI Redesign

- [ ] Build a Post Fiat shell around CryptPad apps.
- [ ] Replace stock landing/login surfaces with wallet-first flows.
- [ ] Replace drive styling with a modern document workspace.
- [ ] Add wallet account panel, balance/network state, and key publication state.
- [ ] Add wallet contacts/address book.
- [ ] Add PFT-native share modal.
- [ ] Review mobile layout for drive, editor, wallet unlock, and share flows.
- [ ] Remove fragile repeated CSS timeout injection from previous prototypes.
- [ ] Add screenshot regression checks for desktop and mobile.

## Phase 7: Server And Deployment

- [ ] Decide whether Post Fiat APIs live in `lib/http-worker.js` or a separate module.
- [ ] Add environment config for PFTL RPC/WSS, network id, IPFS gateway, and pinning backend.
- [ ] Add wallet nonce verification endpoint for server sessions.
- [ ] Add PFTL pointer list endpoint with pagination.
- [ ] Add manifest/blob fetch endpoints preserving signatures.
- [ ] Add Docker compose example for standalone open-source instance.
- [ ] Document AGPL source distribution obligations.

## Phase 8: Security Review

- [ ] Threat model mnemonic handling, wallet signatures, XSS, and malicious documents.
- [ ] Confirm all signing messages are domain-separated.
- [ ] Remove raw mnemonic/localStorage usage from final runtime paths.
- [ ] Review CSP and sandboxing around editors and custom wallet scripts.
- [ ] Verify XRPL transaction construction and network IDs.
- [ ] Verify revocation language in UI is accurate.
- [ ] Review legacy CryptPad raw URL sharing for accidental primary exposure.

## Phase 9: Portability To `pftasks`

- [ ] Keep wallet modules compatible with `pftasks` imports.
- [ ] Keep PFTL document modules framework-agnostic where possible.
- [ ] Define a minimal shared package boundary for wallet, key registry, PFTL docs, and pointer APIs.
- [ ] Add a demo route or adapter proving a PFTL document can be opened from `pftasks`.

## Immediate Next Tasks

1. Push this fork to `agtico/cryptpad-pft`.
2. Port wallet modules from `pftasks/app/src/lib/wallet` into a new Post Fiat customization module.
3. Port the cleaned `walletAuth` login path from `pfdapp/cryptpad`.
4. Build the first wallet unlock/login screen.
5. Implement a minimal share-to-wallet bridge that encrypts a CryptPad URL secret as a PFTL v3 document.
