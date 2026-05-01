# CryptPad PFT Security Audit Findings

Date: 2026-05-01
Commit audited: `3afa74d30a95`
Scope: whole repository manual/static audit pass, not limited to PFT changes.

This file is intended to be a durable handoff artifact. It covers the repo-level attack surface I reviewed: server bootstrap/config/CSP, HTTP/RPC/challenge routes, SSO/MFA/session handling, storage and uploads, client sandbox/SFrame and postMessage boundaries, document apps/importers/exporters, runtime dependencies, and PFT wallet/Nostr/XRPL logic. Runtime data directories such as `blob/`, `block/`, `data/`, and `datastore/` were treated as local instance state, not source.

Severity key:

- P0: catastrophic compromise of document or wallet confidentiality, or a break in the core PFT privacy/security model.
- P1: remotely reachable or user-triggered data compromise, stored/script execution risk, quota/storage DoS, or secret leakage to privileged logs.
- P2: hardening gap, lower-reach bug, dependency issue, or exploit requiring additional misconfiguration/chain.

## Executive Summary

| ID | Severity | Finding |
| --- | --- | --- |
| P0-001 | P0 | PFT Nostr inbox directory events are not bound to the XRPL/PFT wallet, so a forged relay event can hijack future wallet-address shares. |
| P0-002 | P0 | Active PFT wallet sessions can broadcast the raw 24-word mnemonic to any same-origin script/tab. |
| P1-001 | P1 | Blob upload chunk paths bypass max upload size and quota accounting, enabling authenticated storage DoS. |
| P1-002 | P1 | Rich-text pad code detects but does not reject `javascript:` links, while pad CSP still permits unsafe inline script. |
| P1-003 | P1 | MFA/challenge error logging can write TOTP secrets, OTPs, and recovery material into server logs. |
| P1-004 | P1 | Runtime dependency set includes vulnerable CKEditor 4 and high-risk XML parser packages in reachable editor/import/SSO paths. |
| P2-001 | P2 | SSO temporary cookie uses a non-CSPRNG token and lacks `Secure`, `Path`, and explicit lifetime flags. |
| P2-002 | P2 | Wallet-auth login uses unverified wallet address/signature fields as identity input. |
| P2-003 | P2 | PFT Nostr relay normalization accepts plaintext `ws://` relays. |
| P2-004 | P2 | Calendar export and calendar popup rendering have injection hardening gaps. |
| P2-005 | P2 | Diagram/draw.io integration sends decrypted XML with `postMessage(..., '*')` and does not check `event.origin`. |
| P2-006 | P2 | SFrame bootstrap accepts the first matching `postMessage` transaction without an origin/source check, relying heavily on frame-ancestor policy. |
| P2-007 | P2 | Production sandbox safety depends on `httpSafeOrigin` deployment configuration; the fallback is explicitly not production-safe. |

## Fix Status

Current working tree status as of 2026-05-01:

| ID | Status | Notes |
| --- | --- | --- |
| P0-001 | Fixed | Wallet-directory records now carry a canonical XRPL/PFT wallet proof over the Nostr pubkey, relays, origin, version, and creation time. Directory parsing rejects missing or invalid proofs by default, and forged-directory regression tests were added. |
| P0-002 | Fixed | The same-origin BroadcastChannel mnemonic export path is disabled, and wallet-login capability export/import across tabs is disabled. Pad/drive inner frames now request specific wallet share actions from the outer frame and receive only public wallet metadata or completed share results, not raw seed phrases. |
| P1-001 | Fixed | Upload status now requires finite positive integer sizes. WebSocket and HTTP chunk paths require initialized pending upload state, enforce declared size before every write, and completion rejects staged files whose size differs from the declared upload size. Regression tests were added. |
| P1-002 | Fixed with residual hardening | Pad diff sanitization now rejects unsafe URL protocols, including entity/control-character variants and uppercase attribute names. Pad CSP still includes `unsafe-inline`; removing it is a larger compatibility hardening task and should be tracked as residual P2 work. |
| P1-003 | Fixed | Challenge/MFA logging now redacts sensitive request fields, signatures, OTPs, secrets, recovery/contact material, and nested values. TOTP bad-code logging no longer writes the submitted OTP. Regression tests were added for challenge redaction. |
| P1-004 | Fixed with residual dependency exception | XML/parser and other transitive vulnerable packages were upgraded/overridden. CKEditor remains pinned to the last OSS `ckeditor4@4.22.1` because `ckeditor4@4.25.1` is the commercial LTS build and broke pad loading with a license-key failure. CKEditor samples and unused code-snippet plugins are pruned from served components, but `npm audit --omit=dev` still reports one moderate CKEditor advisory group. |
| P2-* | Open | P2 findings below were not part of this fix pass. |

## P0-001: PFT Nostr Directory Spoofing

Affected code:

- `src/postfiat/private-share-workflow.mjs:39-44` builds the directory `d` tag from only the wallet address.
- `src/postfiat/private-share-workflow.mjs:85-100` verifies the Nostr event signature and checks that `event.pubkey === directory.publicKeyHex`, but never verifies that the XRPL/PFT wallet controls that Nostr pubkey.
- `src/postfiat/private-share-workflow.mjs:159-223` fetches directories from relays, sorts by `created_at`, and chooses the newest valid directory.
- `src/postfiat/private-share-workflow.mjs:240-311` encrypts live pad sharing data to the resolved directory public key.
- `src/postfiat/nostr-identity.mjs:277-306` serializes/parses directory records containing `walletAddress`, `publicKeyHex`, `relays`, and `createdAt`, but no wallet proof.

Impact:

An unauthenticated attacker can publish a valid Nostr event for `postfiat:cryptpad:nostr-inbox:v1:<victim wallet>` using the attacker's own Nostr key and relay list. The verifier accepts it because the event is self-consistent, not wallet-authorized. If a user shares a document to the victim wallet address, the client can resolve the attacker's newest directory and encrypt the document capability URL to the attacker.

Evidence:

A local PoC constructed a forged directory for a victim wallet, signed it with the attacker's Nostr key, and passed `parseNostrInboxDirectoryEvent`/`resolvePrivateShareRecipient`:

```json
{
  "acceptedForgedDirectory": true,
  "victimWallet": "rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV",
  "resolvedPublicKey": "5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc",
  "attackerPubkey": "5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc",
  "relays": ["wss://attacker-relay.example"]
}
```

Remediation:

Disable wallet-address private sharing until directory records are wallet-bound. The directory content should include a canonical wallet proof signed by the XRPL/PFT key: wallet address, Nostr pubkey, relay list, origin/app id, protocol version, creation time, expiry, and optional revocation pointer. Verification must recover/validate the wallet address and reject missing, expired, mismatched, or noncanonical proofs. Do not select by "newest relay event" alone; prefer wallet-signed sequence numbers or an authenticated registry/revocation flow.

## P0-002: Same-Origin Mnemonic Broadcast

Affected code:

- `src/postfiat/wallet-core.mjs:377-407` stores an encrypted session wallet, including mnemonic.
- `src/postfiat/wallet-core.mjs:473-509` starts a global `BroadcastChannel` responder.
- `src/postfiat/wallet-core.mjs:495-503` responds to any `SESSION_WALLET_REQUEST` by posting plaintext `mnemonic`, `address`, and `derivationPath`.
- `src/postfiat/wallet-core.mjs:512-587` imports that plaintext mnemonic into the requesting tab.
- `www/common/outer/local-store.js:14-21`, `www/common/outer/local-store.js:105-151`, and `www/common/outer/local-store.js:162-183` implement a similar broad wallet-login session broadcast for CryptPad auth material.

Impact:

Any script running on the same origin as an active PFT wallet tab can ask the global channel for the raw seed phrase. In this repo, same-origin script execution is plausible because the platform hosts multiple rich document apps, editor integrations, import/export surfaces, and known sanitizer issues. This turns an otherwise contained XSS or app compromise into full wallet theft.

Remediation:

Never send a mnemonic through `BroadcastChannel`, `postMessage`, localStorage, sessionStorage payload copies, or UI application state. Replace this with a narrow in-memory signer/encrypter service that returns only the requested signature/encrypted share artifact. Require an explicit user gesture or per-tab capability token established at login, use short TTLs, clear on lock, and bind requests to the expected window/session where possible.

## P1-001: Upload Quota and Max-Size Bypass

Affected code:

- `lib/commands/upload.js:15-17` validates upload size with `&&` where it should reject non-numbers or invalid sizes. Negative values, `NaN`, and some invalid inputs can pass.
- `lib/commands/upload.js:65-71` records `pendingUploadSize` and `currentUploadSize`, but downstream paths do not enforce it.
- `lib/storage/blob.js:275-313` decodes and writes WebSocket upload chunks; the readiness and over-limit checks at `lib/storage/blob.js:285-296` are commented out.
- `lib/storage/blob.js:315-323` appends HTTP upload chunks to the staging file with no expected-size check.
- `lib/storage/blob.js:381-418` and `lib/storage/blob.js:441-500` move staged blobs to final storage without statting the actual staged file size.
- `lib/http-worker.js:800-840` exposes the HTTP chunk upload path once a valid upload cookie is presented.

Impact:

An authenticated user with an RPC session/upload cookie can stream more bytes than the declared file size, exceed `Env.maxUploadSize`, bypass quota accounting, or fill `blobstage`/blob storage. The completed upload is charged using the declared pending size, not the actual bytes moved.

Remediation:

Fix size validation to require a finite positive integer and reject zero/negative/`NaN` values. Enforce `current + decodedChunk.length <= pendingUploadSize` before every write on both WebSocket and HTTP paths. Require an initialized pending upload before any chunk write. Before completion, `stat` the staged file and reject/unlink on mismatch. Charge quota using the actual staged size and add cleanup for abandoned stages.

## P1-002: Pad `javascript:` Link Sanitization Gap

Affected code:

- `www/pad/inner.js:364-387` inspects add/modify attribute diffs. It detects `href` values matching `/javascript *: */`, but only leaves TODO comments and does not reject the diff.
- `www/pad/inner.js:383-386` rejects event-handler attributes, showing this is the intended sanitizer choke point.
- `lib/defaults.js:70-72` sets pad CSP with `script-src 'self' 'unsafe-eval' 'unsafe-inline' resource: ...`.
- `www/pad/inner.js:27` and `www/pad/inner.js:1442-1454` load and instantiate CKEditor.

Impact:

A malicious collaborator or imported rich-text payload can preserve a `javascript:` link in a pad. When another user clicks it, script executes in the pad/editor context. The pad CSP allows inline script, increasing the blast radius. In combination with P0-002, editor-context script execution can become wallet seed exfiltration on the same origin.

Remediation:

Reject dangerous protocols in `preDiffApply`, including case/entity/control-character variants of `javascript:`, `vbscript:`, and unsafe `data:`/`file:`/custom schemes. Normalize with a URL parser and HTML entity decoding before comparison. Configure CKEditor allowed-content/link sanitization defensively. Remove `unsafe-inline` from pad CSP where feasible and use nonces/hashes for unavoidable inline code.

## P1-003: MFA and Challenge Secret Logging

Affected code:

- `lib/http-commands.js:128-143` logs the full challenge command `body` on command errors.
- `lib/http-commands.js:281-291` logs raw `text`, `sig`, and `publicKey` on decode errors.
- `lib/challenge-commands/totp.js:178-190` accepts `publicKey`, `secret`, `code`, and optional `contact` for TOTP setup.
- `lib/challenge-commands/totp.js:211-219` can return validation errors after receiving the TOTP secret and code.
- `lib/challenge-commands/totp.js:157-162` logs rejected OTP codes directly.
- `lib/challenge-commands/totp.js:255-265` stores the TOTP shared secret and optional contact/recovery material.
- `lib/challenge-commands/totp.js:384-391` compares a `secret:` recovery key in plaintext.

Impact:

If TOTP setup or validation fails, server logs can contain the TOTP shared secret, one-time code, recovery key/contact field, and signed challenge material. Anyone with access to logs or centralized log exports can defeat MFA for affected accounts.

Remediation:

Replace full-body logging with structured redaction. Log only command name, public key/account id, stable error code, and request id. Redact `secret`, `code`, `recoveryKey`, `contact`, `auth`, signatures, JWTs, and challenge text. Store recovery keys as a salted server-side hash/HMAC rather than plaintext in `contact`.

## P1-004: Vulnerable Runtime Dependencies

Affected code and dependency graph:

- `package.json:30` pins `ckeditor` to `ckeditor4@~4.22.1`.
- `www/pad/inner.js:27` loads `/components/ckeditor/ckeditor.js`; `www/pad/inner.js:1442-1454` instantiates it.
- `package.json:19` includes `@node-saml/node-saml`; `npm ls` shows `@xmldom/xmldom@0.8.11` through SAML/XML packages.
- `package.json:73` includes `x2js`; `npm ls` shows it also pulls `@xmldom/xmldom@0.8.11`.
- `www/diagram/inner.js:11` imports X2JS; `www/diagram/inner.js:46-47` constructs it.
- `www/diagram/util.js:83-119` parses/decompresses draw.io XML and converts it through X2JS.
- `lib/http-worker.js:246-264` handles SAML response storage.

Evidence:

`npm audit --json` originally reported four advisories: one high and three moderate. Relevant runtime items:

- `@xmldom/xmldom@0.8.11`, high, affected range `<=0.8.12`, advisories include uncontrolled recursion DoS and XML injection issues.
- `ckeditor4@4.22.1`, moderate, affected range `<=4.24.0`, multiple XSS advisories, fix available at `ckeditor4@4.25.1`.
- `follow-redirects@1.15.11`, moderate, via `http-proxy-middleware`.
- `postcss@8.5.6`, moderate, dev/lint path via stylelint.

Impact:

CKEditor is directly reachable in the pad editor and overlaps with the sanitizer weakness in P1-002. XML parsing is reachable through diagram import/conversion and potentially SSO deployments. Even when an advisory depends on optional features, this repo is meant to be self-hostable and should not ship with known vulnerable runtime parser/editor packages.

Remediation:

Upgrade `@xmldom/xmldom` through `@node-saml`, `xml-crypto`, `xml-encryption`, and `x2js` dependency paths, or pin an override if upstream lag blocks it. Patch `follow-redirects` and `postcss` in lockfile. For CKEditor, do not force `ckeditor4@4.25.1` without a valid LTS license because it prevents rich-text pads from loading. Either acquire/license the LTS build, migrate away from CKEditor 4, or keep the current `ckeditor4@4.22.1` exception with served samples and unused vulnerable plugins pruned. Add CI gating on `npm audit --omit=dev` for runtime dependencies and a documented exception process.

## P2-001: SSO Temporary Cookie Weakness

Affected code:

- `lib/http-worker.js:246-264` handles `/ssoauth` SAML responses.
- `lib/http-worker.js:250` generates the SAML request token with `Util.uid()`.
- `src/common/common-util.js:232-235` implements `Util.uid()` with `Math.random()`.
- `lib/http-worker.js:261-262` sets `samltoken` with `SameSite=Strict; HttpOnly` but no `Secure`, `Path`, or explicit lifetime.
- `lib/storage/sso.js:48-55` stores SSO request content by token-derived path.

Impact:

The SAML handoff token is weaker than it should be and may be sent without `Secure` if the site is accessed over HTTP or a proxy misconfiguration occurs. Missing `Path` and lifetime flags broaden cookie scope/duration relative to a short-lived authentication handoff.

Remediation:

Use `crypto.randomBytes`/`Nacl.randomBytes` for the token. Set `Secure; HttpOnly; SameSite=Strict; Path=/ssoauth` or the minimum required callback path, plus a short `Max-Age`. Prefer `__Host-` cookie naming if path/domain constraints allow it. Delete the request token on use.

## P2-002: Wallet Auth Identity Is Not Verified

Affected code:

- `www/common/common-login.js:337-379` treats any `walletAuth.signature` as wallet auth, sets `uname = walletAuth.address || uname`, derives CryptPad entropy from signature bytes, and forces registration.
- `src/common/postfiat-wallet-auth.js:33-39` defines wallet login message templates.
- `src/common/postfiat-wallet-auth.js:75-92` derives entropy from the signature, but there is no local verification that the signature matches the canonical message, public key, or claimed wallet address.

Impact:

A caller can present an arbitrary wallet address as the username/display identity with arbitrary signature bytes. This probably does not let them take over the real wallet owner's CryptPad account because drive entropy is signature-derived, but it breaks the trustworthiness of wallet-address identity in UI, contact, and sharing metadata.

Remediation:

Before using `walletAuth.address`, verify the XRPL/PFT signature against a canonical login message containing address, origin, app id, purpose, timestamp/nonce, and protocol version. Reject mismatched/noncanonical messages. Bind the entropy derivation to the canonical message and address, not signature bytes alone.

## P2-003: Plaintext Nostr Relays Accepted

Affected code:

- `src/postfiat/nostr-identity.mjs:241-261` accepts both `wss:` and `ws:` relay URLs.

Impact:

Giftwrap contents are encrypted, but plaintext relay transport still leaks metadata, timings, IP-level information, and allows relay-level blocking/tampering. For a privacy-oriented PFT-native product, `ws://` should not be accepted outside local development.

Remediation:

Require `wss:` by default. Allow `ws://localhost` or `ws://127.0.0.1` only behind an explicit development flag. Surface a clear validation error in the UI.

## P2-004: Calendar ICS and Popup Injection Hardening

Affected code:

- `www/calendar/export.js:116-134` escapes/folds description partially, but writes `SUMMARY:` and `LOCATION:` with raw document-controlled strings.
- `www/calendar/export.js:162-164` appends `data.cp_hidden` entries verbatim to the exported `.ics`.
- `www/calendar/inner.js:404-414` escapes display text with `Util.fixHTML`, but uses the raw `location` value inside an interpolated `href` attribute.

Impact:

A collaborator-controlled event title/location can inject additional ICS fields or events into an exported calendar file. `cp_hidden` can write arbitrary ICS lines. The popup link path is a lower-reach HTML attribute injection hardening issue.

Remediation:

Apply RFC5545 escaping to all ICS text fields: backslash, comma, semicolon, CRLF, and line folding. Do not export arbitrary `cp_hidden` lines without an allowlist. Build popup links with DOM APIs or escape attributes separately from text content.

## P2-005: Diagram postMessage Target and Origin Checks

Affected code:

- `www/diagram/inner.js:56-62` sends JSON messages to the draw.io frame with target origin `*`.
- `www/diagram/inner.js:71-76` sends decrypted diagram XML during load.
- `www/diagram/inner.js:117-124` sends decrypted XML during content updates.
- `www/diagram/inner.js:199-210` receives draw.io messages by checking only `event.source === drawioFrame.contentWindow`, not `event.origin`.

Impact:

The frame URL is intended to be under `ApiConfig.httpSafeOrigin`, so exploitation requires navigation/compromise/misconfiguration of that frame. If it occurs, decrypted diagram XML is sent to whatever origin is currently loaded in the iframe, and responses from that origin are accepted.

Remediation:

Use `ApiConfig.httpSafeOrigin` as the explicit `postMessage` target origin and reject received messages unless `event.origin === ApiConfig.httpSafeOrigin`. Fail closed if the configured safe origin is missing or does not parse.

## P2-006: SFrame Bootstrap postMessage Origin Reliance

Affected code:

- `www/common/sframe-boot.js:68-74` generates a transaction id and broadcasts `READY` to the parent with target origin `*`.
- `www/common/sframe-boot.js:78-119` accepts a message with the matching transaction id and no explicit `event.origin`/`event.source` check before installing cache/local store bootstrap data.
- `www/common/sframe-common-outer.js:76-78` creates the safe-origin iframe and passes bootstrap config in the hash.

Impact:

This appears to rely on CSP/frame-ancestor deployment invariants to ensure the parent is the trusted unsafe origin. If an admin misconfigures frame embedding or a safe-origin page is framed by an attacker, the attacker parent can receive the transaction id and send forged bootstrap state.

Remediation:

Keep the frame-ancestor restrictions, but also check `event.source === window.parent` and `event.origin === ApiConfig.httpUnsafeOrigin` or a narrowly configured allowed parent origin. Send `READY` to an explicit parent origin when possible.

## P2-007: Production Sandbox Configuration Footgun

Affected code:

- `lib/env.js:98-104` sets `NO_SANDBOX = true` and derives a safe origin from the same host/alternate port when `httpSafeOrigin` is missing.
- `config/config.example.js:53-72` documents that this fallback is not appropriate for production and that `httpSafeOrigin` must differ from `httpUnsafeOrigin`.

Impact:

CryptPad's confidentiality model depends on separating unsafe app UI from sandboxed content. The code allows a non-production fallback, and the current local instance config is gitignored/untracked, so the repo itself cannot enforce that a deployed PFT instance has a true separate safe origin.

Remediation:

Fail startup in production mode unless `httpSafeOrigin` is configured and has a different host from `httpUnsafeOrigin`. Add a deployment check/test that rejects same-origin sandboxing for any public build.

## Immediate Fix Order

1. Disable or gate PFT wallet-address sharing until Nostr directory records require a wallet-signed proof.
2. Remove all raw mnemonic BroadcastChannel/session propagation and replace it with an in-memory signer/encrypter interface.
3. Enforce upload size/quota on every chunk and verify actual staged size before completion.
4. Reject dangerous pad link protocols and resolve the CKEditor 4 dependency exception.
5. Redact challenge/MFA logging and hash recovery keys.
6. Patch runtime dependencies and add audit gating.
7. Harden SSO cookies/tokens, Nostr relay validation, diagram/SFrame message origins, and calendar export escaping.
8. Enforce production `httpSafeOrigin` separation during startup/deployment.

## Commands and Evidence Gathered

Commands used during this audit pass:

```sh
git status --short
git rev-parse --short=12 HEAD
rg --files | wc -l
find . -maxdepth 2 -type d
npm audit --json
npm ls @xmldom/xmldom ckeditor4 follow-redirects postcss --depth=6
rg -n "postMessage\\(|addEventListener\\(['\\\"]message|onmessage\\s*=" www src lib
rg -n "innerHTML\\s*=|outerHTML|insertAdjacentHTML|\\.html\\(" www src
rg -n "Math\\.random|Util\\.uid\\(|randomToken|crypto\\.random|randomBytes|Nacl\\.randomBytes" lib www src
```

Whole-repo source inventory at the time of audit was 5915 tracked files via `rg --files | wc -l`. The working tree was clean before adding this file.
