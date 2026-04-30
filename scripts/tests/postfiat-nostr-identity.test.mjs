// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildNostrDerivationMessage,
    buildNostrInboxDirectoryRecord,
    deriveNostrIdentityFromMnemonic,
    normalizeNostrRelayList,
    parseNostrInboxDirectoryRecord,
    serializeNostrInboxDirectoryRecord,
} from '../../src/postfiat/nostr-identity.mjs';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const TEST_ADDRESS = 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC';
const ORIGIN = 'https://docs.postfiat.example';

test('derives a deterministic Nostr identity from a Post Fiat wallet signature', async () => {
    const identity = await deriveNostrIdentityFromMnemonic(TEST_MNEMONIC, {
        origin: ORIGIN,
    });
    const sameIdentity = await deriveNostrIdentityFromMnemonic(TEST_MNEMONIC, {
        origin: `${ORIGIN}/`,
    });
    const chatIdentity = await deriveNostrIdentityFromMnemonic(TEST_MNEMONIC, {
        origin: ORIGIN,
        purpose: 'cryptpad-private-chat',
    });

    assert.equal(identity.walletAddress, TEST_ADDRESS);
    assert.equal(identity.origin, ORIGIN);
    assert.equal(identity.purpose, 'cryptpad-private-sharing');
    assert.match(identity.publicKeyHex, /^[0-9a-f]{64}$/u);
    assert.match(identity.privateKeyHex, /^[0-9a-f]{64}$/u);
    assert.equal(identity.publicKeyHex, sameIdentity.publicKeyHex);
    assert.equal(identity.privateKeyHex, sameIdentity.privateKeyHex);
    assert.notEqual(identity.publicKeyHex, chatIdentity.publicKeyHex);
    assert.equal(
        identity.derivationMessage,
        buildNostrDerivationMessage({
            walletAddress: TEST_ADDRESS,
            origin: ORIGIN,
            purpose: 'cryptpad-private-sharing',
        })
    );
});

test('normalizes Nostr relay lists for config and directory records', () => {
    assert.deepEqual(normalizeNostrRelayList([
        'wss://relay.example/',
        'wss://relay.example',
        'ws://localhost:7777/path/',
    ]), [
        'wss://relay.example',
        'ws://localhost:7777/path',
    ]);
    assert.throws(() => normalizeNostrRelayList(['https://relay.example']), /INVALID_NOSTR_RELAY_URL/);
    assert.throws(() => normalizeNostrRelayList(['wss://user:pass@relay.example']), /INVALID_NOSTR_RELAY_URL/);
});

test('serializes Nostr inbox directory records canonically', () => {
    const record = buildNostrInboxDirectoryRecord({
        walletAddress: TEST_ADDRESS,
        publicKeyHex: 'A'.repeat(64),
        relays: ['wss://relay.postfiat.example/', 'wss://relay.postfiat.example'],
        createdAt: '2026-04-30T00:00:00.000Z',
    });

    assert.deepEqual(record, {
        kind: 'postfiat-nostr-inbox',
        version: 1,
        walletAddress: TEST_ADDRESS,
        publicKeyHex: 'a'.repeat(64),
        relays: ['wss://relay.postfiat.example'],
        createdAt: '2026-04-30T00:00:00.000Z',
    });
    assert.equal(
        serializeNostrInboxDirectoryRecord(record),
        '{"createdAt":"2026-04-30T00:00:00.000Z","kind":"postfiat-nostr-inbox","publicKeyHex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","relays":["wss://relay.postfiat.example"],"version":1,"walletAddress":"rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC"}'
    );
    assert.deepEqual(parseNostrInboxDirectoryRecord(record), record);
});
