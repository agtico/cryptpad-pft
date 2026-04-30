// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { hexToBytes } from '@noble/hashes/utils.js';

import {
    buildPrivateShareGiftWrap,
} from '../../src/postfiat/nostr-private-share.mjs';
import {
    buildGiftWrapInboxFilter,
    fetchGiftWrapsFromRelay,
    fetchGiftWrapsFromRelays,
    publishNostrEventToRelay,
    publishNostrEventToRelays,
} from '../../src/postfiat/nostr-relay-client.mjs';

const SENDER_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const RECIPIENT_PUBLIC_KEY = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const WRAPPER_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000003';

const makeGiftWrap = () => buildPrivateShareGiftWrap({
    senderPrivateKeyHex: SENDER_PRIVATE_KEY,
    recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY,
    wrapperPrivateKeyHex: WRAPPER_PRIVATE_KEY,
    rumorCreatedAt: 1777564800,
    sealCreatedAt: 1777564700,
    wrapCreatedAt: 1777564600,
    sealNonce: hexToBytes('55'.repeat(32)),
    wrapNonce: hexToBytes('66'.repeat(32)),
    payload: {
        href: '/pad/#/2/pad/edit/example/',
        mode: 'edit',
        createdAt: '2026-04-30T00:00:00.000Z',
    },
}).giftWrap;

const createFakeWebSocket = ({ giftWrap, rejectPublish } = {}) => {
    const sockets = [];
    class FakeWebSocket {
        constructor(url) {
            this.url = url;
            this.sent = [];
            this.closed = false;
            sockets.push(this);
            setTimeout(() => this.onopen && this.onopen(), 0);
        }
        send(message) {
            this.sent.push(message);
            const parsed = JSON.parse(message);
            if (parsed[0] === 'EVENT') {
                setTimeout(() => this.onmessage && this.onmessage({
                    data: JSON.stringify([
                        'OK',
                        parsed[1].id,
                        !rejectPublish,
                        rejectPublish ? 'blocked: nope' : '',
                    ]),
                }), 0);
            }
            if (parsed[0] === 'REQ') {
                setTimeout(() => {
                    if (giftWrap) {
                        this.onmessage && this.onmessage({
                            data: JSON.stringify(['EVENT', parsed[1], giftWrap]),
                        });
                    }
                    this.onmessage && this.onmessage({
                        data: JSON.stringify(['EOSE', parsed[1]]),
                    });
                }, 0);
            }
        }
        close() {
            this.closed = true;
        }
    }
    return { FakeWebSocket, sockets };
};

test('builds a gift-wrap inbox filter for recipient p-tags', () => {
    assert.deepEqual(buildGiftWrapInboxFilter({
        recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY.toUpperCase(),
        since: 1777560000,
        until: 1777569999,
        limit: 25,
    }), {
        kinds: [1059],
        '#p': [RECIPIENT_PUBLIC_KEY],
        limit: 25,
        since: 1777560000,
        until: 1777569999,
    });
});

test('publishes gift wraps to a relay and records relay acceptance', async () => {
    const giftWrap = makeGiftWrap();
    const { FakeWebSocket, sockets } = createFakeWebSocket();
    const result = await publishNostrEventToRelay({
        relayUrl: 'wss://relay.postfiat.example/',
        event: giftWrap,
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.deepEqual(result, {
        relayUrl: 'wss://relay.postfiat.example',
        eventId: giftWrap.id,
        accepted: true,
        message: '',
    });
    assert.equal(JSON.parse(sockets[0].sent[0])[0], 'EVENT');
    assert.equal(sockets[0].closed, true);
});

test('publishes to multiple relays and keeps rejection details', async () => {
    const giftWrap = makeGiftWrap();
    const { FakeWebSocket } = createFakeWebSocket({ rejectPublish: true });
    const results = await publishNostrEventToRelays({
        relayUrls: ['wss://relay-a.example', 'wss://relay-a.example'],
        event: giftWrap,
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].accepted, false);
    assert.match(results[0].message, /blocked: nope/);
});

test('fetches valid gift wraps from a relay inbox subscription', async () => {
    const giftWrap = makeGiftWrap();
    const { FakeWebSocket, sockets } = createFakeWebSocket({ giftWrap });
    const result = await fetchGiftWrapsFromRelay({
        relayUrl: 'wss://relay.postfiat.example/',
        recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY,
        subscriptionId: 'inbox',
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(result.relayUrl, 'wss://relay.postfiat.example');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].id, giftWrap.id);
    assert.equal(JSON.parse(sockets[0].sent[0])[0], 'REQ');
    assert.equal(JSON.parse(sockets[0].sent.at(-1))[0], 'CLOSE');
});

test('deduplicates gift wraps fetched from multiple relays', async () => {
    const giftWrap = makeGiftWrap();
    const { FakeWebSocket } = createFakeWebSocket({ giftWrap });
    const result = await fetchGiftWrapsFromRelays({
        relayUrls: ['wss://relay-a.example', 'wss://relay-b.example'],
        recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY,
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(result.results.length, 2);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].id, giftWrap.id);
});
