// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const assert = require('node:assert/strict');
const test = require('node:test');

const Auth = require('../../lib/postfiat-wallet-auth');

test('formats domain-separated Post Fiat wallet messages', () => {
    assert.equal(
        Auth.getLoginMessage('rTEST'),
        'I am willing to sign up as rTEST on a postfiat.org domain to use Post Fiat Services. DO NOT SIGN THIS MESSAGE ON ANY OTHER DOMAINS!'
    );
    assert.equal(Auth.getV3AccessMessage('rTEST'), 'PostFiat Access: rTEST');
});

test('derives deterministic CryptPad entropy from a wallet signature', () => {
    const entropy = Auth.deriveCryptPadEntropy('00'.repeat(64));

    assert.equal(entropy.length, 192);
    assert.equal(
        Buffer.from(entropy.slice(0, 32)).toString('hex'),
        '0ae3b85d61aaf39ac43503444cc3bbe06a73ec67022a2f3741eb3ea5492b4b1c'
    );
    assert.equal(
        Buffer.from(entropy.slice(160, 192)).toString('hex'),
        'b58057a67c88f6c4fdac8a42cde6e6a4fad4c64f4dc3dd73f30ae01a4d629c55'
    );
});

test('derives the legacy PFT wallet channel bytes from the encryption seed', () => {
    const entropy = Auth.deriveCryptPadEntropy('00'.repeat(64));
    const channelBytes = Auth.deriveWalletChannelBytes(entropy.slice(0, 18));

    assert.equal(channelBytes.length, 16);
    assert.equal(Buffer.from(channelBytes).toString('hex'), '15e229c9333121d82ac04213c8800134');
});

test('rejects malformed hex signatures', () => {
    assert.throws(() => Auth.deriveCryptPadEntropy('xyz'), /INVALID_HEX_SIGNATURE/);
    assert.throws(() => Auth.deriveCryptPadEntropy('abc'), /INVALID_HEX_SIGNATURE/);
});
