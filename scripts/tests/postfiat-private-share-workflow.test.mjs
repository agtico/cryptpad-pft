// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { hexToBytes } from '@noble/hashes/utils.js';

import { signNostrEvent } from '../../src/postfiat/nostr-private-share.mjs';
import {
    buildNostrInboxDirectoryRecord,
    deriveNostrIdentityFromMnemonic,
    parseNostrInboxDirectoryRecord,
} from '../../src/postfiat/nostr-identity.mjs';
import {
    buildLivePadPrivateShare,
    buildNostrInboxDirectoryDTag,
    buildOwnNostrInboxDirectory,
    buildSignedNostrInboxDirectoryEvent,
    fetchNostrInboxDirectories,
    fetchAndOpenLivePadPrivateShares,
    normalizePrivateShareRecipient,
    NOSTR_KIND_POSTFIAT_DIRECTORY,
    openLivePadPrivateShare,
    parseNostrInboxDirectoryEvent,
    publishOwnNostrInboxDirectory,
    publishLivePadPrivateShare,
    resolvePrivateShareRecipient,
    selectPrivateShareRelays,
} from '../../src/postfiat/private-share-workflow.mjs';

const SENDER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const RECIPIENT_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
const ORIGIN = 'https://docs.postfiat.example';

const makeRecipientDirectory = async (relays = ['wss://recipient-relay.example']) => {
    const built = await buildSignedNostrInboxDirectoryEvent({
        mnemonic: RECIPIENT_MNEMONIC,
        origin: ORIGIN,
        relayUrls: relays,
        createdAt: '2026-04-30T00:00:00.000Z',
    });
    return built.directory;
};

const createFakeWebSocket = ({ giftWrap, event, events } = {}) => {
    const relayEvents = events || [giftWrap, event].filter(Boolean);
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
                    relayEvents.forEach((relayEvent) => {
                        this.onmessage && this.onmessage({
                            data: JSON.stringify(['EVENT', parsed[1], relayEvent]),
                        });
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

test('publishes and resolves wallet Nostr inbox directory events', async () => {
    const builtDirectory = await buildSignedNostrInboxDirectoryEvent({
        mnemonic: RECIPIENT_MNEMONIC,
        relayUrls: ['wss://directory-relay.example/'],
        origin: ORIGIN,
        createdAt: '2026-04-30T00:00:00.000Z',
        eventCreatedAt: 1777564800,
    });

    assert.equal(builtDirectory.directory.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
    assert.equal(
        builtDirectory.event.tags[0][1],
        buildNostrInboxDirectoryDTag('rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV')
    );
    assert.deepEqual(parseNostrInboxDirectoryEvent(builtDirectory.event).directory, builtDirectory.directory);

    const { FakeWebSocket, sockets } = createFakeWebSocket({ event: builtDirectory.event });
    const fetched = await fetchNostrInboxDirectories({
        walletAddress: 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV',
        relayUrls: ['wss://directory-relay.example/'],
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(fetched.directories.length, 1);
    assert.deepEqual(fetched.directories[0].directory, builtDirectory.directory);
    assert.deepEqual(JSON.parse(sockets[0].sent[0])[2], {
        kinds: [30078],
        '#d': [buildNostrInboxDirectoryDTag('rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV')],
        limit: 10,
    });

    const resolved = await resolvePrivateShareRecipient(
        'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV',
        {
            relayUrls: ['wss://directory-relay.example/'],
            WebSocketImpl: FakeWebSocket,
            timeoutMs: 100,
        }
    );
    assert.deepEqual(resolved, builtDirectory.directory);
});

test('builds a wallet-proven inbox directory when createdAt is omitted', async () => {
    const builtDirectory = await buildSignedNostrInboxDirectoryEvent({
        mnemonic: RECIPIENT_MNEMONIC,
        relayUrls: ['wss://directory-relay.example/'],
        origin: ORIGIN,
        eventCreatedAt: 1777564800,
    });

    assert.doesNotThrow(() => parseNostrInboxDirectoryEvent(builtDirectory.event));
    assert.equal(
        builtDirectory.directory.walletProof.message.includes(
            `"createdAt":"${builtDirectory.directory.createdAt}"`
        ),
        true
    );
});

test('rejects forged wallet directory events without wallet proof', async () => {
    const attacker = await deriveNostrIdentityFromMnemonic(SENDER_MNEMONIC, {
        origin: ORIGIN,
    });
    const forgedDirectory = buildNostrInboxDirectoryRecord({
        walletAddress: 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV',
        publicKeyHex: attacker.publicKeyHex,
        relays: ['wss://attacker-relay.example'],
        createdAt: '2026-04-30T00:00:00.000Z',
    });

    assert.throws(() => parseNostrInboxDirectoryRecord(forgedDirectory), /INVALID_NOSTR_DIRECTORY_WALLET_PROOF/);

    const forgedEvent = signNostrEvent({
        kind: NOSTR_KIND_POSTFIAT_DIRECTORY,
        created_at: 1777564800,
        tags: [
            ['d', buildNostrInboxDirectoryDTag(forgedDirectory.walletAddress)],
        ],
        content: JSON.stringify(forgedDirectory),
    }, attacker.privateKeyHex);
    const { FakeWebSocket } = createFakeWebSocket({ event: forgedEvent });

    await assert.rejects(resolvePrivateShareRecipient(forgedDirectory.walletAddress, {
        relayUrls: ['wss://directory-relay.example/'],
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    }), /POSTFIAT_RECIPIENT_DIRECTORY_INVALID/);
});

test('publishes own wallet directory to relays', async () => {
    const { FakeWebSocket } = createFakeWebSocket();
    const published = await publishOwnNostrInboxDirectory({
        mnemonic: RECIPIENT_MNEMONIC,
        relayUrls: ['wss://directory-relay.example/'],
        origin: ORIGIN,
        createdAt: '2026-04-30T00:00:00.000Z',
        eventCreatedAt: 1777564800,
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(published.publishResults[0].accepted, true);
    assert.equal(published.directory.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
});

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

test('accepts pubkey-only private share recipients with configured relay fallback', async () => {
    const identity = await deriveNostrIdentityFromMnemonic(RECIPIENT_MNEMONIC, {
        origin: ORIGIN,
    });
    const recipient = normalizePrivateShareRecipient(identity.publicKeyHex);

    assert.deepEqual(recipient, {
        publicKeyHex: identity.publicKeyHex,
        relays: [],
    });

    const built = await buildLivePadPrivateShare({
        senderMnemonic: SENDER_MNEMONIC,
        recipientDirectory: {
            publicKeyHex: identity.publicKeyHex,
            relays: [],
        },
        postFiatConfig: {
            nostr: {
                privateRelays: ['wss://instance-relay.example/', 'wss://backup-relay.example'],
            },
        },
        origin: ORIGIN,
        href: '/pad/#/2/pad/edit/example/',
        title: 'Relay fallback share',
        mode: 'view',
    });

    assert.equal(built.recipient.publicKeyHex, identity.publicKeyHex);
    assert.equal(built.recipient.walletAddress, undefined);
    assert.deepEqual(built.relays, ['wss://instance-relay.example', 'wss://backup-relay.example']);
});

test('builds an own inbox directory from the current wallet mnemonic', async () => {
    const directory = await buildOwnNostrInboxDirectory({
        mnemonic: RECIPIENT_MNEMONIC,
        postFiatConfig: {
            nostr: {
                privateRelays: ['wss://private.example'],
            },
        },
        origin: ORIGIN,
        createdAt: '2026-04-30T00:00:00.000Z',
    });

    assert.equal(directory.kind, 'postfiat-nostr-inbox');
    assert.equal(directory.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
    assert.deepEqual(directory.relays, ['wss://private.example']);
    assert.equal(directory.origin, ORIGIN);
    assert.equal(directory.walletProof.version, 1);
    assert.deepEqual(parseNostrInboxDirectoryRecord(directory), directory);
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

test('builds a private share by resolving a wallet address through directory relays', async () => {
    const builtDirectory = await buildSignedNostrInboxDirectoryEvent({
        mnemonic: RECIPIENT_MNEMONIC,
        relayUrls: ['wss://directory-relay.example/'],
        origin: ORIGIN,
        createdAt: '2026-04-30T00:00:00.000Z',
        eventCreatedAt: 1777564800,
    });
    const { FakeWebSocket } = createFakeWebSocket({ event: builtDirectory.event });

    const built = await buildLivePadPrivateShare({
        senderMnemonic: SENDER_MNEMONIC,
        recipientDirectory: 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV',
        directoryRelays: ['wss://directory-relay.example/'],
        origin: ORIGIN,
        href: '/pad/#/2/pad/edit/example/',
        title: 'Wallet address share',
        mode: 'edit',
        currentTime: 1777564800,
        rumorCreatedAt: 1777564800,
        sealCreatedAt: 1777564700,
        wrapCreatedAt: 1777564600,
        sealNonce: hexToBytes('bb'.repeat(32)),
        wrapNonce: hexToBytes('cc'.repeat(32)),
        wrapperPrivateKeyHex: '0000000000000000000000000000000000000000000000000000000000000003',
        WebSocketImpl: FakeWebSocket,
        timeoutMs: 100,
    });

    assert.equal(built.recipient.walletAddress, 'rf1Xs7YGJpz1YzU9prwXhSrhz21v2LhtXV');
    assert.equal(built.recipient.publicKeyHex, builtDirectory.directory.publicKeyHex);
    assert.equal(built.payload.title, 'Wallet address share');
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
