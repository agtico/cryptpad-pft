// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildDomainValue,
    buildMessageKeyAccountSet,
    buildMessageKeyValue,
    normalizeNetworkId,
    parseDomainX25519,
    parseMessageKeyX25519,
    selectRecipientX25519Key,
    x25519PublicKeyBase64ToHex,
    x25519PublicKeyHexToBase64,
} from '../../src/postfiat/key-registry.mjs';

const KEY_HEX = '000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F';
const KEY_BASE64 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

test('converts X25519 public keys between hex and base64', () => {
    assert.equal(x25519PublicKeyHexToBase64(KEY_HEX), KEY_BASE64);
    assert.equal(x25519PublicKeyBase64ToHex(KEY_BASE64), KEY_HEX);
    assert.throws(() => x25519PublicKeyHexToBase64('abcd'), /INVALID_X25519_PUBLIC_KEY_HEX/);
    assert.throws(() => x25519PublicKeyBase64ToHex('abcd'), /INVALID_X25519_PUBLIC_KEY_BASE64/);
});

test('parses Task Node MessageKey X25519 records', () => {
    assert.deepEqual(parseMessageKeyX25519(`ed${KEY_HEX.toLowerCase()}`), {
        source: 'messageKey',
        publicKeyHex: KEY_HEX,
        publicKeyBase64: KEY_BASE64,
    });
    assert.equal(buildMessageKeyValue(KEY_HEX), `ED${KEY_HEX}`);
    assert.equal(parseMessageKeyX25519(''), null);
    assert.equal(parseMessageKeyX25519('ABCDEF'), null);
});

test('parses legacy Domain X25519 records', () => {
    assert.deepEqual(parseDomainX25519(`profile=1; x25519:${KEY_BASE64}; ed25519:abc`), {
        source: 'domain',
        publicKeyHex: KEY_HEX,
        publicKeyBase64: KEY_BASE64,
    });
    assert.equal(buildDomainValue(KEY_BASE64), `x25519:${KEY_BASE64}`);
    assert.equal(parseDomainX25519('example.com'), null);
});

test('prefers MessageKey over Domain when both are available', () => {
    assert.equal(selectRecipientX25519Key({
        messageKey: buildMessageKeyValue(KEY_HEX),
        domain: buildDomainValue('//////////////////////////////////////////8='),
    }).publicKeyHex, KEY_HEX);
    assert.equal(selectRecipientX25519Key({
        domain: buildDomainValue(KEY_BASE64),
    }).source, 'domain');
    assert.equal(selectRecipientX25519Key({}), null);
});

test('builds an AccountSet transaction shape for MessageKey publication', () => {
    assert.deepEqual(buildMessageKeyAccountSet({
        account: 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC',
        x25519PublicKeyHex: KEY_HEX,
        networkId: '2025',
    }), {
        TransactionType: 'AccountSet',
        Account: 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC',
        MessageKey: `ED${KEY_HEX}`,
        NetworkID: 2025,
    });
    assert.equal(normalizeNetworkId('bad'), 2025);
    assert.throws(() => buildMessageKeyAccountSet({
        account: 'alice',
        x25519PublicKeyHex: KEY_HEX,
    }), /INVALID_ACCOUNT_WALLET/);
});
