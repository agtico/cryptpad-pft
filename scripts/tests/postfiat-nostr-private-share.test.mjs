// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { schnorr } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils.js';

import {
    NOSTR_KIND_GIFT_WRAP,
    NOSTR_KIND_PRIVATE_DIRECT_MESSAGE,
    NOSTR_KIND_SEAL,
    buildPrivateShareGiftWrap,
    calcNip44PaddedLength,
    decryptNip44Payload,
    encryptNip44Payload,
    getNip44ConversationKey,
    getNostrPublicKeyHex,
    signNostrEvent,
    unwrapPrivateShareGiftWrap,
    verifyNostrEvent,
} from '../../src/postfiat/nostr-private-share.mjs';

const SENDER_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const RECIPIENT_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000002';
const WRAPPER_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000003';
const SENDER_PUBLIC_KEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const RECIPIENT_PUBLIC_KEY = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const NIP44_TEST_NONCE = '0000000000000000000000000000000000000000000000000000000000000001';

test('matches the NIP-44 v2 published encryption vector', () => {
    const conversationKey = getNip44ConversationKey({
        privateKeyHex: SENDER_PRIVATE_KEY,
        publicKeyHex: RECIPIENT_PUBLIC_KEY,
    });
    assert.equal(
        Buffer.from(conversationKey).toString('hex'),
        'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d'
    );

    const payload = encryptNip44Payload({
        plaintext: 'a',
        conversationKey,
        nonce: hexToBytes(NIP44_TEST_NONCE),
    });

    assert.equal(
        payload,
        'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb'
    );
    assert.equal(decryptNip44Payload({ payload, conversationKey }), 'a');
});

test('pads NIP-44 plaintext according to the spec buckets', () => {
    assert.equal(calcNip44PaddedLength(1), 32);
    assert.equal(calcNip44PaddedLength(32), 32);
    assert.equal(calcNip44PaddedLength(33), 64);
    assert.equal(calcNip44PaddedLength(256), 256);
    assert.equal(calcNip44PaddedLength(257), 320);
    assert.equal(calcNip44PaddedLength(65535), 65536);
    assert.throws(() => calcNip44PaddedLength(0), /INVALID_NIP44_PLAINTEXT_LENGTH/);
});

test('signs and verifies Nostr events with NIP-01 ids', () => {
    assert.equal(getNostrPublicKeyHex(SENDER_PRIVATE_KEY), SENDER_PUBLIC_KEY);
    assert.equal(getNostrPublicKeyHex(RECIPIENT_PRIVATE_KEY), RECIPIENT_PUBLIC_KEY);

    const signed = signNostrEvent({
        kind: 14,
        tags: [['p', RECIPIENT_PUBLIC_KEY]],
        content: 'hello',
        created_at: 1777564800,
    }, SENDER_PRIVATE_KEY);

    assert.equal(signed.pubkey, SENDER_PUBLIC_KEY);
    assert.equal(verifyNostrEvent(signed), true);
    assert.equal(schnorr.verify(
        hexToBytes(signed.sig),
        hexToBytes(signed.id),
        hexToBytes(SENDER_PUBLIC_KEY)
    ), true);
    assert.equal(verifyNostrEvent({ ...signed, content: 'tampered' }), false);
});

test('wraps and unwraps a Post Fiat live-pad share with NIP-59 style layers', () => {
    const wrapped = buildPrivateShareGiftWrap({
        senderPrivateKeyHex: SENDER_PRIVATE_KEY,
        recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY,
        recipientRelay: 'wss://relay.postfiat.example',
        wrapperPrivateKeyHex: WRAPPER_PRIVATE_KEY,
        rumorCreatedAt: 1777564800,
        sealCreatedAt: 1777564700,
        wrapCreatedAt: 1777564600,
        sealNonce: hexToBytes('11'.repeat(32)),
        wrapNonce: hexToBytes('22'.repeat(32)),
        payload: {
            href: '/pad/#/2/pad/edit/example/',
            title: 'Strategy note',
            mode: 'edit',
            createdAt: '2026-04-30T00:00:00.000Z',
            sharedByWallet: 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC',
        },
    });

    assert.equal(wrapped.rumor.kind, NOSTR_KIND_PRIVATE_DIRECT_MESSAGE);
    assert.equal(wrapped.rumor.pubkey, SENDER_PUBLIC_KEY);
    assert.equal(wrapped.seal.kind, NOSTR_KIND_SEAL);
    assert.deepEqual(wrapped.seal.tags, []);
    assert.equal(wrapped.giftWrap.kind, NOSTR_KIND_GIFT_WRAP);
    assert.deepEqual(wrapped.giftWrap.tags, [
        ['p', RECIPIENT_PUBLIC_KEY, 'wss://relay.postfiat.example'],
    ]);
    assert.equal(verifyNostrEvent(wrapped.seal), true);
    assert.equal(verifyNostrEvent(wrapped.giftWrap), true);

    const unwrapped = unwrapPrivateShareGiftWrap({
        giftWrap: wrapped.giftWrap,
        recipientPrivateKeyHex: RECIPIENT_PRIVATE_KEY,
    });

    assert.equal(unwrapped.senderPublicKeyHex, SENDER_PUBLIC_KEY);
    assert.equal(unwrapped.recipientPublicKeyHex, RECIPIENT_PUBLIC_KEY);
    assert.equal(unwrapped.rumor.id, wrapped.rumor.id);
    assert.equal(unwrapped.envelope.payload.href, '/pad/#/2/pad/edit/example/');
    assert.equal(unwrapped.envelope.payload.title, 'Strategy note');
});

test('rejects tampered private share wraps', () => {
    const wrapped = buildPrivateShareGiftWrap({
        senderPrivateKeyHex: SENDER_PRIVATE_KEY,
        recipientPublicKeyHex: RECIPIENT_PUBLIC_KEY,
        wrapperPrivateKeyHex: WRAPPER_PRIVATE_KEY,
        rumorCreatedAt: 1777564800,
        sealCreatedAt: 1777564700,
        wrapCreatedAt: 1777564600,
        sealNonce: hexToBytes('33'.repeat(32)),
        wrapNonce: hexToBytes('44'.repeat(32)),
        payload: {
            href: '/pad/#/2/pad/edit/example/',
            mode: 'view',
            createdAt: '2026-04-30T00:00:00.000Z',
        },
    });

    assert.throws(() => unwrapPrivateShareGiftWrap({
        giftWrap: signNostrEvent({
            ...wrapped.giftWrap,
            content: `${wrapped.giftWrap.content.slice(0, 20)}A${wrapped.giftWrap.content.slice(21)}`,
        }, WRAPPER_PRIVATE_KEY),
        recipientPrivateKeyHex: RECIPIENT_PRIVATE_KEY,
    }), /INVALID_NIP44_MAC/);
});
