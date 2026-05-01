const test = require('node:test');
const assert = require('node:assert/strict');

const Default = require('../../lib/defaults');

test('Post Fiat Nostr relays are allowed by CSP connect-src', () => {
    const csp = Default.contentSecurity({
        httpUnsafeOrigin: 'https://docs.example',
        httpSafeOrigin: 'https://sandbox.example',
        postFiat: {
            nostr: {
                relays: ['wss://relay.example/path'],
                privateRelays: ['wss://relay.primal.net', 'wss://nos.lol'],
                relayProxy: 'https://relay-proxy.example/api',
            },
        },
    });

    assert.match(csp, /connect-src[^;]+wss:\/\/relay\.example/u);
    assert.match(csp, /connect-src[^;]+wss:\/\/relay\.primal\.net/u);
    assert.match(csp, /connect-src[^;]+wss:\/\/nos\.lol/u);
    assert.match(csp, /connect-src[^;]+https:\/\/relay-proxy\.example/u);
    assert.doesNotMatch(csp, /relay\.example\/path/u);
    assert.doesNotMatch(csp, /relay-proxy\.example\/api/u);
});
