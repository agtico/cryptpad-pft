# Post Fiat CryptPad Deployment

This fork is AGPL-3.0-or-later. If you run a modified public instance, make the complete corresponding source available to users of that instance, including local modifications, build scripts, and deployment glue needed to rebuild the running service.

## Instance Shape

Run this as a CryptPad instance with Post Fiat defaults enabled:

- wallet-first login enabled;
- legacy username/password login visible only for migration unless explicitly disabled;
- normal private sharing routed through encrypted Nostr relay delivery;
- PFTL/IPFS durable publishing kept behind explicit user action;
- production traffic served through either Tor onion services or HTTPS with separate main and sandbox origins.

Do not run production on a single origin. CryptPad's sandbox origin is part of its XSS containment model.

Cloudflare Tunnel is deprecated as the default public testing/deployment path for this fork. It is easy to run, but it centralizes metadata and gives the instance a provider-owned URL. Prefer onion services for no-KYC/no-origin-IP access, or use a VPS/Caddy/WireGuard edge if you need normal browser clearnet access.

## Onion Deployment

Read `docs/postfiat/ONION_DEPLOYMENT.md` first.

For local onion development:

```sh
npm run dev:onion
```

This creates two v3 onion services, one for `httpUnsafeOrigin` and one for `httpSafeOrigin`, writes the local gitignored `config/config.js`, and keeps CryptPad bound to localhost.

For a manually managed Tor deployment, set:

```js
module.exports = {
    httpUnsafeOrigin: 'http://main-address.onion',
    httpSafeOrigin: 'http://sandbox-address.onion',
    httpAddress: '127.0.0.1',
    httpPort: 3200,
    websocketPort: 3203,
    logIP: false,
    postFiat: {
        walletFirst: true,
        disableLegacyLogin: false,
        nostr: {
            privateRelays: ['wss://relay.example.com'],
        },
    },
};
```

HTTP is acceptable for `.onion` origins because onion services provide authenticated encrypted transport. The main and sandbox origins must still be distinct.

## Minimal Docker Compose

The example at `docs/postfiat/docker-compose.example.yml` builds this repository instead of pulling the upstream `cryptpad/cryptpad` image.

Prepare a `config/config.js` from `config/config.example.js` and set at least:

```js
module.exports = {
    httpUnsafeOrigin: 'https://docs.example.com',
    httpSafeOrigin: 'https://sandbox.docs.example.com',
    httpAddress: '0.0.0.0',
    httpPort: 3000,
    websocketPort: 3003,
    postFiat: {
        walletFirst: true,
        disableLegacyLogin: false,
        pftl: {
            networkId: 2025,
            rpcUrl: '',
            wssUrl: '',
            ipfsGateway: '',
        },
        nostr: {
            relays: ['wss://relay.example.com'],
            privateRelays: ['wss://relay.example.com'],
            relayProxy: '',
        },
    },
};
```

## Relay Privacy Notes

Nostr relays do not see document plaintext or CryptPad capability payloads, but they can still observe IP addresses, timing, relay choice, approximate event sizes, and retention behavior. Operators should prefer relays they control, make retention policy explicit, and avoid silently routing private document activity through public third-party relays.

## Durable PFTL/IPFS Notes

PFTL/IPFS publication is not the default sharing mode. Durable publication can expose CIDs, gateway access patterns, pinning providers, timing, and long-lived pointer existence. Label it as export/publication and do not trigger it from normal share-to-wallet flows.

## Operational Checklist

- Configure Tor onion services or TLS and reverse proxy websocket traffic for `/cryptpad_websocket`.
- Use distinct main and sandbox origins, even for onion services.
- Set `logIP: false` unless there is a concrete legal requirement.
- Configure PFT-operated or self-hosted Nostr relay defaults before enabling share-by-wallet-address for users.
- Keep backups of `blob`, `block`, `data`, and `datastore`.
- Publish the exact source for the running instance to satisfy AGPL obligations.
