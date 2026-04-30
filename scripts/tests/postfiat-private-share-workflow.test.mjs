// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { hexToBytes } from '@noble/hashes/utils.js';

import {
    buildNostrInboxDirectoryRecord,
    deriveNostrIdentityFromMnemonic,
} from '../../src/postfiat/nostr-identity.mjs';
import {
    buildLivePadPrivateShare,
    fetchAndOpenLivePadPrivateShares,
    openLivePadPrivateShare,
    publishLivePadPrivateShare,
    selectPrivateShareRelays,
} from '../../src/postfiat/private-share-workflow.mjs';

const SENDER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const RECIPIENT_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
const ORIGIN = 'https://docs.postfiat.example';

const makeRecipientDirectory = async (relays = ['wss://recipient-relay.example']) => {
    const identity = await deriveNostrIdentityFromMnemonic(RECIPIENT_MNEMONIC, {
        origin: ORIGIN,
    });
    return buildNostrInboxDirectoryRecord({
        walletAddress: identity.walletAddress,
        publicKeyHex: identity.publicKeyHex,
        relays,
        createdAt: '2026-04-30T00:00:00.000Z',
    });
};

const createFakeWebSocket = ({ giftWrap } = {}) => {
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
                    data: JSON.stringify(['OK', parsed[1].id, true, '']),
                }), 0);
            }
            if (parsed[0] === 'REQ') {
                setTimeout(() => {
                    this.onmessage && this.onmessage({
                        data: JSON.stringify(['EVENT', parsed[1], giftWrap]),
                    });
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

test('selects recipient relays before instance relay fallbacks', async () => {
    const directory = await makeRecipientDirectory(['wss://recipient.example/']);
    assert.deepEqual(selectPrivateShareRelays({
        recipientDirectory: directory,
        postFiatConfig: {
            nostr: {
                privateRelays: ['wss://private.example'],
                relays: ['wss://public.example'],
            },
        },
    }), ['wss://recipient.example']);

    assert.deepEqual(selectPrivateShareRelays({
        recipientDirectory: { ...directory, relays: [] },
        postFiatConfig: {
            nostr: {
                privateRelays: ['wss://private.example'],
                relays: ['wss://public.example'],
            },
        },
    }), ['wss://private.example']);
});

test('builds and opens a live-pad private share from PFT wallet mnemonics', async () => {
    const directory = await makeRecipientDirectory();
    const built = await buildLivePadPrivateShare({
        senderMnemonic: SENDER_MNEMONIC,
        recipientDirectory: directory,
        origin: ORIGIN,
        href: '/pad/#/2/pad/edit/example/',
        title: 'Strategy note',
        mode: 'edit',
        createdAt: '2026-04-30T00:00:00.000Z',
        currentTime: 1777564800,
        rumorCreatedAt: 1777564800,
        sealCreatedAt: 1777564700,
        wrapCreatedAt: 1777564600,
        sealNonce: hexToBytes('77'.repeat(32)),
        wrapNonce: hexToBytes('88'.repeat(32)),
        wrapperPrivateKeyHex: '0000000000000000000000000000000000000000000000000000000000000003',
    });

    assert.equal(built.sender.walletAddress, 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC');
    assert.equal(built.recipient.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
    assert.deepEqual(built.relays, ['wss://recipient-relay.example']);
    assert.equal(built.payload.sharedByWallet, 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC');

    const opened = await openLivePadPrivateShare({
        recipientMnemonic: RECIPIENT_MNEMONIC,
        giftWrap: built.giftWrap,
        origin: ORIGIN,
    });

    assert.equal(opened.recipient.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
    assert.equal(opened.payload.href, '/pad/#/2/pad/edit/example/');
    assert.equal(opened.payload.title, 'Strategy note');
});

test('publishes and fetches live-pad private shares through relay helpers', async () => {
    const directory = await makeRecipientDirectory();
    const { FakeWebSocket: PublisherSocket, sockets: publishSockets } = createFakeWebSocket();
    const published = await publishLivePadPrivateShare({
        senderMnemonic: SENDER_MNEMONIC,
        recipientDirectory: directory,
        origin: ORIGIN,
        href: '/pad/#/2/pad/edit/example/',
        mode: 'view',
        createdAt: '2026-04-30T00:00:00.000Z',
        currentTime: 1777564800,
        rumorCreatedAt: 1777564800,
        sealCreatedAt: 1777564700,
        wrapCreatedAt: 1777564600,
        sealNonce: hexToBytes('99'.repeat(32)),
        wrapNonce: hexToBytes('aa'.repeat(32)),
        wrapperPrivateKeyHex: '0000000000000000000000000000000000000000000000000000000000000003',
        WebSocketImpl: PublisherSocket,
        timeoutMs: 100,
    });

    assert.equal(published.publishResults[0].accepted, true);
    assert.equal(JSON.parse(publishSockets[0].sent[0])[0], 'EVENT');

    const { FakeWebSocket: FetchSocket } = createFakeWebSocket({
        giftWrap: published.giftWrap,
    });
    const inbox = await fetchAndOpenLivePadPrivateShares({
        recipientMnemonic: RECIPIENT_MNEMONIC,
        relayUrls: published.relays,
        origin: ORIGIN,
        WebSocketImpl: FetchSocket,
        timeoutMs: 100,
    });

    assert.equal(inbox.shares.length, 1);
    assert.equal(inbox.failures.length, 0);
    assert.equal(inbox.shares[0].payload.mode, 'view');
    assert.equal(inbox.shares[0].payload.href, '/pad/#/2/pad/edit/example/');
});
