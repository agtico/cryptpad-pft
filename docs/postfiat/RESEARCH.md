# Post Fiat CryptPad Research

Date: 2026-04-30

This document captures the local repository research that led to the architecture and burndown. It is intentionally concrete so another agent can continue from file paths instead of re-discovering the same systems.

## Upstream CryptPad

Fresh upstream fork source:

- Local source checked: `/home/pfrpc/repos/cryptpad`
- Fresh fork clone: `/home/pfrpc/repos/cryptpad-pft`
- Upstream remote: `https://github.com/cryptpad/cryptpad.git`
- Upstream head used: `9004ad2dd1b40d571b25f66dfe968606233f51a8`

The existing local upstream checkout was dirty in `docker-compose.yml`, so the fork was created from a fresh clone rather than mutating that checkout.

### Native Login Model

Important upstream files:

- `www/common/common-login.js`
- `src/common/common-hash.js`
- `www/common/outer/login-block.js`

CryptPad login derives 192 bytes from username/password, allocates those bytes into:

- drive encryption/channel material,
- Curve25519 contact keys,
- Ed25519 signing keys,
- login block keys.

The modern login path writes a login block that points to the encrypted user drive. The useful hook for wallet login is to supply deterministic wallet-derived entropy in place of password-derived entropy and keep the rest of CryptPad's drive/login machinery intact.

### Native Sharing Model

Important upstream files:

- `src/common/common-hash.js`
- `www/common/inner/share.js`
- `www/common/drive-ui.js`

CryptPad sharing is fundamentally URL-capability based:

- edit/view secrets are encoded in URL hash fragments such as `/pad/#/1/edit/...` or `/code/#/2/code/view/...`;
- drive entries store `href`, `roHref`, and sometimes a document password;
- the share modal copies the selected edit/view URL or sends it to CryptPad contacts/teams.

The good part: URL fragments are not sent to the HTTP server. The bad part: "who can access this" is controlled by possession of raw capability links, not by Post Fiat wallet ownership.

## Existing Post Fiat CryptPad Work

The strongest existing implementation is under:

- `/home/pfrpc/repos/pfdapp/cryptpad`
- `/home/pfrpc/repos/pfdapp/docs/WALLET_DOCUMENT_SHARING_AND_OWNERSHIP.md`
- `/home/pfrpc/repos/tasknodedocs/cryptpad-customizations`

### Wallet Login

Important files:

- `/home/pfrpc/repos/pfdapp/cryptpad/www/common/common-login.js`
- `/home/pfrpc/repos/pfdapp/cryptpad/www/common/common-util.js`
- `/home/pfrpc/repos/pfdapp/cryptpad/www/customize/login.js`
- `/home/pfrpc/repos/pfdapp/cryptpad/customize/www/common/postfiat-crypto.js`

Existing logic already adds a `walletAuth` path to `Login.loginOrRegister`:

- skip password derivation,
- derive 192 bytes from an XRPL wallet signature,
- allocate those bytes into CryptPad drive/login keys,
- set the username to the wallet address,
- treat the flow as login-or-register/upsert.

The shared wallet signing message in `postfiat-crypto.js` is:

```text
I am willing to sign up as <ADDRESS> on a postfiat.org domain to use Post Fiat Services. DO NOT SIGN THIS MESSAGE ON ANY OTHER DOMAINS!
```

For PFTL v3 storage access, the canonical access message is:

```text
PostFiat Access: <ADDRESS>
```

The existing derivation has both older HKDF salt `"PostFiat"` and newer v3 salt `"PostFiat_v1"`. New work should standardize on the v3 derivation for PFTL document keys.

### Existing PFTL Document Sharing

Important files:

- `/home/pfrpc/repos/pfdapp/cryptpad/customize/www/ipfs/index.html`
- `/home/pfrpc/repos/pfdapp/cryptpad/lib/http-worker.js`
- `/home/pfrpc/repos/pfdapp/cryptpad/lib/proto/access_manifest.proto`
- `/home/pfrpc/repos/pfdapp/cryptpad/lib/proto/content_blob.proto`
- `/home/pfrpc/repos/pfdapp/cryptpad/lib/proto/pointer_v2.proto`

Existing document sharing uses:

- encrypted immutable `ContentBlob`,
- replaceable `AccessManifest` with one wrapped file key per recipient,
- XRPL Payment memo pointer with `MemoType=pf.ptr`, `MemoFormat=v2`, and `MemoData=Pointer{cid, artifact_type}`.

The `/ipfs/` viewer already supports:

- unwrapping the current user's file key from `AccessManifest.access_list`,
- decrypting the encrypted content blob,
- adding a recipient by wrapping the same file key to their published X25519 key,
- publishing a new access manifest,
- sending a pointer transaction to the recipient wallet.

This is the best foundation for wallet-native document sharing.

Current gap: the API/viewer path should expose and verify signature fields on manifests and content blobs, and bind those signing keys back to wallet identity via a key registry.

## SPRS Wallet Auth And Token Logic

Important files:

- `/home/pfrpc/repos/sprs/app/production_app.py`
- `/home/pfrpc/repos/sprs/app/services/auth.py`
- `/home/pfrpc/repos/sprs/app/notebook_proxy.py`
- `/home/pfrpc/repos/sprs/app/services/notebook_shares.py`
- `/home/pfrpc/repos/sprs/app/services/cryptpad_escrow.py`
- `/home/pfrpc/repos/sprs/app/services/wallet_keys.py`

Useful pieces:

- nonce issuance and signature verification,
- XRPL public key -> classic address check,
- `keypairs.is_valid_message(...)` verification,
- Flask session fields for authenticated wallet,
- HMAC URL token pattern for notebook proxy access,
- share DB model for server-mediated resources.

Important caveat: `services/auth.py` is explicitly marked as not active for M1 and warns that its SQL string interpolation must be replaced before activation.

The SPRS CryptPad escrow path is not the right canonical model for an open-source cross-instance PFT-native fork. It uses central DB share tables and locally unlocked wallet seeds to wrap/unwrap CryptPad keys. That may remain useful as a migration/reference path, but it is less portable than PFTL manifests and pointer memos.

## Task Node 24-Word Seed Phrase Logic

Important files:

- `/home/pfrpc/repos/pftasks/app/src/lib/wallet/derive.js`
- `/home/pfrpc/repos/pftasks/app/src/lib/wallet/crypto.js`
- `/home/pfrpc/repos/pftasks/app/src/lib/wallet/wallet.js`
- `/home/pfrpc/repos/pftasks/app/src/lib/wallet/session.js`
- `/home/pfrpc/repos/pftasks/app/src/lib/context/crypto.js`
- `/home/pfrpc/repos/pftasks/app/src/lib/pftl/transactions.js`

Task Node wallet behavior:

- 24-word mnemonic generated with `@scure/bip39` at 256 bits of entropy;
- XRPL wallet derived with `Wallet.fromMnemonic(..., { mnemonicEncoding: "bip39", derivationPath: "m/44'/144'/0'/0/0" })`;
- encrypted wallet storage uses PBKDF2-SHA256 with 250,000 iterations and AES-GCM-256;
- current browser session stores a non-extractable AES-GCM key in IndexedDB and encrypted mnemonic in `sessionStorage`;
- X25519 context keys can be deterministically derived from the mnemonic;
- `ensureMessageKeyPublished` publishes the wallet's X25519 public key to XRPL `AccountSet.MessageKey` with prefix `ED`.

For this fork, Task Node style mnemonic login should be the primary in-browser wallet path. MetaMask Snap login can remain optional for users who already use that workflow.

## Existing Task Node Wallet Standalone Repo

Important files:

- `/home/pfrpc/repos/tasknode-wallet/src/wallet/index.ts`
- `/home/pfrpc/repos/tasknode-wallet/src/wallet/keystore.ts`
- `/home/pfrpc/repos/tasknode-wallet/src/wallet/pftl.ts`

This repo currently uses XRPL family seeds, not the newer 24-word BIP39 flow. Treat `pftasks/app/src/lib/wallet` as the current source of truth for 24-word seed phrases.

## Conclusions

1. Use CryptPad's login machinery, but replace password-derived entropy with wallet-signature-derived entropy.
2. Use the wallet classic address as the user identity.
3. Prefer Task Node's 24-word BIP39 wallet as the native login path.
4. Keep MetaMask PFTL Snap as an optional login path.
5. Use PFTL v3 manifests and XRPL pointer memos as the canonical share system.
6. Bridge live CryptPad pads by encrypting their secret URLs through PFTL first; do not expose raw CryptPad links as the PFT-native UX.
7. Treat revocation honestly: removing a key shard does not revoke a file key that a recipient has already seen. Strong revocation requires rotating content and file keys.
