# Post Fiat Native Architecture

## Product Shape

This fork should be a Post Fiat document app built on CryptPad, not a lightly themed CryptPad instance.

Primary user-facing concepts:

- wallet account,
- wallet drive,
- wallet contacts,
- documents shared to/from wallets,
- PFTL document pointers,
- live collaborative pads as one supported document type.

CryptPad internals should remain where they are strong: encrypted realtime editing, drive storage, pad apps, and operational deployment. Post Fiat should own identity, wallet login, and cross-wallet sharing.

## Identity And Login

### Wallet Identity

Canonical user id:

```text
XRPL classic address, e.g. r...
```

Supported login methods:

1. Task Node 24-word seed phrase wallet.
2. Existing MetaMask PFTL Snap wallet.

Task Node native login should use the same BIP39 and derivation path as `pftasks`:

```text
m/44'/144'/0'/0/0
```

The browser wallet should never require a server-side seed unlock. A server nonce challenge can be used to prove possession, but CryptPad account material should remain deterministically recoverable from a wallet signature.

### CryptPad Account Derivation

Use one canonical wallet-auth signature to derive CryptPad account entropy:

1. derive/sign the XRPL wallet from the 24-word mnemonic, or ask the Snap to sign;
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

### Phase 1: PFTL Bridge For Live CryptPad Pads

This is the fastest useful product:

1. User creates or opens a normal CryptPad pad.
2. Instead of showing raw link-sharing as the primary action, the app offers "Share to wallet".
3. The share action serializes the pad capability secret:

```json
{
  "kind": "cryptpad-live-pad",
  "href": "/pad/#/...",
  "title": "...",
  "mode": "edit|view",
  "created_at": "..."
}
```

4. Encrypt the payload as a PFTL v3 content object.
5. Publish/update an access manifest.
6. Send an XRPL `pf.ptr/v2` pointer memo to the recipient wallet.
7. Recipient opens their PFT inbox, decrypts the payload, and imports/opens the pad.

This keeps the realtime CryptPad model intact while removing raw URL sharing from the primary Post Fiat UX.

### Phase 2: Native PFTL Documents

The target model for portable cross-instance documents:

- `ContentBlob`: encrypted immutable document payload.
- `AccessManifest`: replaceable recipient key-shard list pointing to the content CID.
- `pf.ptr/v2`: ledger pointer memo delivering/indexing the manifest CID.

The current `pfdapp/cryptpad/customize/www/ipfs/index.html` already proves this model. This fork should modularize that code and integrate it into the main drive/share UI.

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
- contacts,
- document editor,
- share-to-wallet modal,
- PFTL document inspector/debug panel for early builds.

Design constraints:

- modern operational SaaS feel, not stock CryptPad retro UI;
- dense but readable document tables and sidebars;
- icon buttons for tools;
- no huge decorative landing hero;
- clear wallet/account state in the shell;
- PFT-native share action should be more prominent than raw link copy.

## Security Notes

- Do not store raw mnemonics in localStorage.
- Reuse the `pftasks` session pattern: non-extractable key in IndexedDB plus encrypted session material in sessionStorage.
- Review the existing `pftasks` localStorage encrypted-wallet backup before copying it; it improves recovery but broadens XSS blast radius.
- Keep all wallet-signing messages domain-separated and human-readable.
- Verify XRPL signatures server-side when issuing server sessions.
- Verify PFTL content/manifest signatures client-side before showing ownership claims.
- Keep AGPL source availability requirements visible in deployment docs.
