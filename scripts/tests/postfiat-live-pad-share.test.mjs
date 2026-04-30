// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LIVE_PAD_SHARE_CONTENT_TYPE,
    PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE,
    buildLivePadSharePayload,
    buildPftlContentEnvelope,
    buildPrivateShareEnvelope,
    parseLivePadSharePayload,
    serializeLivePadSharePayload,
} from '../../src/postfiat/live-pad-share.mjs';

const OWNER = 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC';
const RECIPIENT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

test('builds a canonical live CryptPad share payload', () => {
    const payload = buildLivePadSharePayload({
        href: '/pad/#/2/pad/edit/example/',
        title: 'Strategy note',
        mode: 'VIEW',
        ownerWallet: OWNER,
        sharedByWallet: RECIPIENT,
        createdAt: '2026-04-30T00:00:00.000Z',
        metadata: {
            z: 1,
            a: {
                b: 2,
            },
        },
    });

    assert.deepEqual(payload, {
        kind: 'cryptpad-live-pad',
        version: 1,
        href: '/pad/#/2/pad/edit/example/',
        title: 'Strategy note',
        mode: 'view',
        createdAt: '2026-04-30T00:00:00.000Z',
        ownerWallet: OWNER,
        sharedByWallet: RECIPIENT,
        metadata: {
            a: {
                b: 2,
            },
            z: 1,
        },
    });

    assert.equal(
        serializeLivePadSharePayload(payload),
        '{"createdAt":"2026-04-30T00:00:00.000Z","href":"/pad/#/2/pad/edit/example/","kind":"cryptpad-live-pad","metadata":{"a":{"b":2},"z":1},"mode":"view","ownerWallet":"rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC","sharedByWallet":"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh","title":"Strategy note","version":1}'
    );
});

test('round-trips a Nostr private share envelope for live pads', () => {
    const envelope = buildPrivateShareEnvelope({
        href: 'https://docs.example/pad/#/2/pad/edit/example/',
        mode: 'edit',
        createdAt: '2026-04-30T00:00:00.000Z',
    }, {
        createdAt: '2026-04-30T00:01:00.000Z',
    });

    assert.equal(envelope.envelopeVersion, 1);
    assert.equal(envelope.envelopeContentType, PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE);
    assert.equal(envelope.transport, 'nostr');
    assert.equal(envelope.contentType, LIVE_PAD_SHARE_CONTENT_TYPE);
    assert.equal(envelope.createdAt, '2026-04-30T00:01:00.000Z');
    assert.equal(
        parseLivePadSharePayload(envelope.plaintext).href,
        'https://docs.example/pad/#/2/pad/edit/example/'
    );
});

test('keeps a durable PFTL envelope for explicit publish/export flows', () => {
    const envelope = buildPftlContentEnvelope({
        href: '/pad/#/2/pad/edit/example/',
        mode: 'view',
        createdAt: '2026-04-30T00:00:00.000Z',
    });

    assert.equal(envelope.envelopeVersion, 1);
    assert.equal(envelope.transport, 'pftl');
    assert.equal(envelope.contentType, LIVE_PAD_SHARE_CONTENT_TYPE);
    assert.equal(parseLivePadSharePayload(envelope.plaintext).mode, 'view');
});

test('rejects malformed live pad share payloads', () => {
    assert.throws(() => buildLivePadSharePayload({ href: 'javascript:alert(1)' }), /INVALID_LIVE_PAD_HREF/);
    assert.throws(() => buildLivePadSharePayload({ href: '/pad/#x', mode: 'owner' }), /INVALID_LIVE_PAD_SHARE_MODE/);
    assert.throws(() => buildLivePadSharePayload({
        href: '/pad/#x',
        ownerWallet: 'alice',
    }), /INVALID_OWNER_WALLET/);
    assert.throws(() => buildPrivateShareEnvelope({
        href: '/pad/#x',
    }, {
        transport: 'ipfs',
    }), /INVALID_PRIVATE_SHARE_TRANSPORT/);
    assert.throws(() => parseLivePadSharePayload({
        kind: 'other',
        version: 1,
        href: '/pad/#x',
    }), /UNSUPPORTED_LIVE_PAD_SHARE_PAYLOAD/);
});
