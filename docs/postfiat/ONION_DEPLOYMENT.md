# Post Fiat Onion Deployment

Tor onion services are the preferred no-KYC, no-origin-IP exposure path for privacy-oriented Post Fiat Docs instances. Cloudflare Tunnel is deprecated for this fork's default hosted testing path because it introduces a centralized metadata provider and a provider-owned public URL.

## Local Onion Dev

Start the onion service and CryptPad together:

```sh
npm run dev:onion
```

Despite the historical command name, this runs CryptPad in production-style cache mode. It does not set `DEV=1`, because dev mode appends a fresh timestamp to every `urlArgs` response and forces browsers to redownload the interface on every page load. That is unusable over Tor.

Or start only Tor, write `config/config.js`, and inspect the generated URLs:

```sh
npm run onion:start
npm run onion:status
npm run onion:check
```

The script:

- runs Tor as the current user;
- uses system `tor` if present;
- otherwise downloads and extracts the Ubuntu `tor` package into `.postfiat-onion/tools`;
- creates separate v3 onion services for CryptPad main and sandbox origins;
- maps both onion services to the local CryptPad HTTP server;
- writes a local gitignored `config/config.js` with onion origins;
- generates `.gz` and `.br` precompressed static assets before starting CryptPad;
- keeps CryptPad bound to `127.0.0.1`.

Runtime state lives under `.postfiat-onion/` by default. Do not commit that directory. It contains the onion service private keys.

## Required Shape

CryptPad still needs distinct main and sandbox origins. For onion deployments this means two onion hostnames:

```js
config.httpUnsafeOrigin = 'http://main-address.onion';
config.httpSafeOrigin = 'http://sandbox-address.onion';
config.httpAddress = '127.0.0.1';
config.httpPort = 3200;
config.websocketPort = 3203;
```

HTTP is acceptable for `.onion` origins because Tor onion services provide authenticated encrypted transport at the onion layer. Do not collapse the main and sandbox origins into one onion address.

## Operations

Use `npm run onion:status` to print the current onion addresses and Tor process state.

Use `npm run onion:check` to fetch `/api/config` through the local Tor SOCKS proxy and verify that the app is advertising onion origins.

Use `npm run onion:stop` to stop the Tor process started by `scripts/postfiat-onion-dev.sh`.

Use `npm run onion:dev` only for local code iteration. It sets `DEV=1`, disables stable cache keys, and will make onion page loads much slower.

## Performance Requirements

Do not run the public onion endpoint with `npm run dev` or `DEV=1 node server.js`.

The onion path depends on:

- stable `?ver=` cache keys for JS/CSS/assets;
- browser reuse of cached interface files between document opens;
- precompressed `.gz`/`.br` copies under `www/`;
- keeping large optional apps lazy-loaded.

If load times regress, first check:

```sh
npm run onion:check
curl --socks5-hostname 127.0.0.1:19050 -I -H 'Accept-Encoding: br,gzip' \
  "http://$(cat .postfiat-onion/tor-data/cryptpad-main/hostname)/common/sframe-common-outer.js?ver=test"
```

The static JS response should include long-lived cache headers and `Content-Encoding: br` or `gzip`.

If you need clearnet access, prefer a VPS edge proxy plus WireGuard back to the origin or Caddy/Let's Encrypt on a normal domain. Treat that as a different trust model. Do not route the default privacy product through Cloudflare Tunnel.

## Threat Notes

Onion services hide the origin IP from visitors and avoid ICANN/DNS/KYC dependencies for the app URL. They do not hide browser-side connections to third-party relays, gateways, fonts, analytics, or other external resources. The app should keep normal document sharing on encrypted Nostr payloads, support private relay choices, and avoid silently contacting IPFS/PFTL infrastructure from normal share flows.
