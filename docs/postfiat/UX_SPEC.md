# Post Fiat Docs UX Spec

## Product Direction

This should feel like a Post Fiat document workspace that happens to use CryptPad's realtime encrypted editor engine. Users should not have to understand CryptPad accounts, raw capability URLs, unsafe/safe iframe boundaries, or saved browser vault mechanics.

Primary product objects:

- wallet
- document
- contact
- private share
- inbox message
- durable publication

Primary user promise:

```text
Open your PFT wallet, create private documents, and share them to other PFT wallets without putting the share graph on-chain by default.
```

## Navigation Model

### App Shell

Use a new Post Fiat shell as the default logged-in experience.

Top bar:

- app name: `Post Fiat Docs`
- global search
- `New` button
- wallet badge: address, lock state, copy address
- relay/network status
- settings icon

Left rail:

- `Docs`
- `Shared with me`
- `Sent`
- `Contacts`
- `Durable`
- `Settings`

Main content should be dense and operational. No hero pages, no marketing cards, no giant CryptPad-style icon walls.

### Routes

Recommended product routes:

```text
/app/                 workspace home
/app/docs/            owned/recent documents
/app/shared/          encrypted Nostr inbox
/app/sent/            sent private shares
/app/contacts/        wallet contacts
/app/durable/         explicit PFTL/IPFS publications
/app/settings/        wallet, relays, instance config
/doc/:id              editor shell around a live CryptPad pad
/login/               wallet-first login only
```

The existing CryptPad `/drive/` route can remain available during migration but should not be the primary destination after wallet login.

## Login UX

### Login Screen

Default screen:

- `Unlock saved wallet`
- `Restore with seed phrase`
- `Create new wallet`

Secondary compatibility action:

- `Use legacy CryptPad login`

Do not show username/password as the default. Do not call the vault password a username or account password. The copy should make the model clear:

```text
Wallet password
Unlocks the encrypted wallet saved on this browser.
```

### Create Wallet

Flow:

1. Generate a 24-word seed phrase.
2. Require the user to confirm they saved it.
3. Set a local wallet password.
4. Save encrypted browser vault.
5. Open `/app/`.

### Restore Wallet

Flow:

1. Paste 24-word seed phrase.
2. Derive and show wallet address.
3. Optional: save encrypted wallet on this browser.
4. Open `/app/`.

### Session Rules

The visible app shell has one wallet state:

- `Unlocked`
- `Locked`
- `No saved wallet`
- `Wrong wallet for this account`

Any surface that can open a document under a wallet account must be able to ask the shell for the active wallet session. Users should never see a share modal that says `No saved wallet found` while the document is already open under the same wallet.

## Workspace Home

### Docs View

Default columns:

- document title
- type
- owner wallet
- last opened
- shared state
- actions

Primary actions:

- open
- share
- rename
- move/archive

Filters:

- all
- owned by me
- shared by me
- recently opened
- archived

### Empty State

Show direct creation actions:

- `New document`
- `Import`
- `Open shared document`

Avoid explanatory marketing text.

## Editor Shell

The editor should be full viewport, with CryptPad embedded as the editing engine.

Header:

- back to workspace
- document title
- sync state
- participant count
- `Share`
- overflow menu

Right panel tabs:

- `Share`
- `Chat`
- `Info`
- `History`

CryptPad's native editor toolbar can remain inside the editor where necessary, but drive/share/account controls should move to the Post Fiat shell.

## Share UX

### Primary Share Modal

Title:

```text
Share to wallet
```

Fields:

- recipient: contact search or PFT wallet address
- permission: segmented control, `View` / `Edit`
- optional note
- relay policy: compact status line, expandable advanced settings

Primary action:

```text
Send private share
```

Result:

- show delivery status by relay
- save recipient as contact when successful
- show `Open sent record` only if sent-share tracking exists

### Recipient Resolution

If recipient is a known contact:

- use saved wallet directory and relay set

If recipient is a wallet address:

- fetch wallet directory from configured relays
- if missing, show a clear blocked state:

```text
This wallet has not published a private sharing inbox yet.
```

Recovery actions:

- copy invite request
- enter inbox JSON manually
- advanced: enter Nostr pubkey and relay list

### Advanced Share

Collapsed section:

- copy raw CryptPad link
- copy inbox JSON
- custom relay list
- durable publish

Raw links should be labeled as compatibility/advanced. They should not be the primary CTA.

## Shared With Me

Inbox view should feel like email, not a debugging panel.

Rows:

- document title
- sender wallet/contact
- permission
- received time
- relay source
- actions: open, save to docs, archive

States:

- refreshing
- no shares
- some relays unavailable
- undecryptable message
- sender unknown

Undecryptable or malformed relay events should be hidden behind a compact diagnostics drawer.

## Sent Shares

Show shares published from this wallet:

- document
- recipient wallet/contact
- permission
- relay delivery status
- sent time

Important language:

```text
Removing a share stops future discovery where possible. Anyone who already opened the document may still retain access unless the document is rotated.
```

For live CryptPad pads, revocation must not overpromise.

## Contacts

Contact object:

- display name
- wallet address
- Nostr inbox pubkey
- preferred relays
- last successful share
- verification status

Primary actions:

- share
- edit
- copy address
- refresh inbox directory

Contacts should remove the need to paste pubkeys or inbox JSON after first setup.

## Durable Publishing

Durable PFTL/IPFS publishing must be an explicit workspace area and editor action. It is not normal sharing.

Entry points:

- `/app/durable/`
- editor overflow: `Publish durable copy`

Before publishing, show a privacy review:

- document CID may be observable
- pinning provider may observe timing/IP
- gateways may observe fetches
- ledger pointers may be durable
- revocation requires content/key rotation

Primary CTA:

```text
Publish durable copy
```

Do not silently create IPFS manifests or PFTL pointers from normal share actions.

## Settings

Settings sections:

- Wallet
- Relays
- Privacy
- Instance
- Legacy CryptPad

Wallet:

- address
- lock wallet
- save/remove browser vault
- export public inbox directory
- rotate private sharing inbox

Relays:

- PFT default relays
- user relays
- private relay proxy status
- test relay connectivity

Privacy:

- explain Nostr metadata limits
- durable publishing warnings
- local vault storage

Legacy CryptPad:

- raw drive route
- raw link sharing
- compatibility login

## Mobile Layout

Mobile shell:

- bottom nav: Docs, Shared, New, Contacts, Settings
- wallet badge in top sheet
- editor header compressed to back, title, share, menu
- share flow as full-screen sheet
- no tiny sidebars or multi-column modals

## Visual Direction

Use a restrained operational SaaS style:

- clean table/list views
- compact panels
- clear icon buttons
- 8px radius or less
- neutral background with restrained accents
- avoid decorative gradients, giant cards, and stock CryptPad icon grids

Core color roles:

- background
- surface
- border
- text
- muted text
- primary action
- warning
- danger
- success

The UI should not be dominated by one hue family. Wallet/network states should use small status indicators rather than full-page color treatments.

## Implementation Burndown

### UX Phase A: Product Shell

- [ ] Add `/app/` route as the wallet workspace home.
- [ ] Redirect successful wallet login to `/app/`, not `/drive/`.
- [ ] Build top bar with wallet badge, lock state, search, and new document action.
- [ ] Build left rail and mobile bottom nav.
- [ ] Keep `/drive/` accessible as legacy/advanced during migration.

### UX Phase B: Documents View

- [ ] Wrap CryptPad drive data in a Post Fiat document list.
- [ ] Add owned/shared/recent/archive filters.
- [ ] Add document row actions: open, share, rename, archive.
- [ ] Replace stock CryptPad drive as the default workspace view.
- [ ] Add empty states for new wallet accounts.

### UX Phase C: Editor Shell

- [ ] Open live CryptPad pads inside a Post Fiat editor shell.
- [ ] Move account/share controls out of CryptPad editor modals where feasible.
- [ ] Add right-side panels for Share, Chat, Info, and History.
- [ ] Keep raw CryptPad controls in an advanced escape hatch only.

### UX Phase D: Share Flow

- [ ] Replace Access rights/Post Fiat tab with a dedicated `Share to wallet` sheet.
- [ ] Use contact search and wallet-address resolution as the default recipient input.
- [ ] Hide raw Nostr pubkey/inbox JSON behind advanced controls.
- [ ] Show relay delivery status in human terms.
- [ ] Save successful recipients as contacts automatically.
- [ ] Keep raw CryptPad link copy in advanced compatibility actions.

### UX Phase E: Inbox And Sent

- [ ] Build `/app/shared/` as a first-class encrypted inbox.
- [ ] Add open/save/archive actions.
- [ ] Build `/app/sent/` for sent share history and delivery status.
- [ ] Add compact diagnostics for malformed or undecryptable relay events.
- [ ] Add browser e2e test for wallet A sharing to wallet B.

### UX Phase F: Contacts

- [ ] Build contact list and contact detail views.
- [ ] Add refresh/publish private inbox directory actions.
- [ ] Add manual advanced recipient import for first-contact recovery.
- [ ] Add verification state for wallet directory records.

### UX Phase G: Durable Publishing

- [ ] Build `/app/durable/` around explicit PFTL/IPFS publishing.
- [ ] Add durable publish action to editor overflow.
- [ ] Add privacy review step before publication.
- [ ] Add manifest/CID/signature inspector for early builds.
- [ ] Keep durable publishing out of normal share flow.

### UX Phase H: QA

- [ ] Add screenshot regression checks for desktop workspace, editor, share, inbox, contacts, and mobile.
- [ ] Add e2e coverage for wallet login -> app shell -> create doc -> share -> recipient inbox -> open doc.
- [ ] Add e2e coverage for locked wallet states and wrong-wallet states.
- [ ] Add e2e coverage proving normal sharing does not publish PFTL/IPFS artifacts.
