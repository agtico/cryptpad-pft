// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_DERIVATION_PATH,
    WALLET_VAULT_STORAGE_KEY,
    clearSavedWallet,
    createMnemonic,
    decryptMnemonicVault,
    deriveWalletFromMnemonic,
    encryptMnemonicVault,
    getSavedWalletMeta,
    isValidMnemonic,
    messageToHex,
    normalizeMnemonic,
    saveWallet,
    signMessage,
    unlockSavedWallet,
    verifyMessage,
} from '../../src/postfiat/wallet-core.mjs';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const TEST_ADDRESS = 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC';
const TEST_PUBLIC_KEY = '03543B859FF40BF433302D20A322DB4EAD92D112F6C20F52864468262E083DC9EE';
const TEST_ACCESS_MESSAGE = `PostFiat Access: ${TEST_ADDRESS}`;
const TEST_ACCESS_SIGNATURE = '30450221008A2DE9A6BC4185AF7B2332654148FD12886B3032B8E22EA215726CE68596987F022055C2B7B41E96E4FC9D67342B96F274AC6CD51DBE82F9DF97975A3A9D5E380AF3';

const makeStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
};

test('normalizes and validates 24-word BIP39 mnemonics', () => {
    assert.equal(normalizeMnemonic(`  ${TEST_MNEMONIC.toUpperCase()}  `), TEST_MNEMONIC);
    assert.equal(isValidMnemonic(TEST_MNEMONIC), true);
    assert.equal(isValidMnemonic(TEST_MNEMONIC.replace(/ art$/, ' abandon')), false);
    assert.equal(createMnemonic().split(' ').length, 24);
});

test('derives the Task Node XRPL wallet path', () => {
    const wallet = deriveWalletFromMnemonic(TEST_MNEMONIC);

    assert.equal(wallet.derivationPath, DEFAULT_DERIVATION_PATH);
    assert.equal(wallet.address, TEST_ADDRESS);
    assert.equal(wallet.publicKey, TEST_PUBLIC_KEY);
});

test('signs and verifies canonical Post Fiat access messages', () => {
    const signed = signMessage(TEST_MNEMONIC, TEST_ACCESS_MESSAGE);

    assert.equal(messageToHex(TEST_ACCESS_MESSAGE), signed.messageHex);
    assert.equal(signed.address, TEST_ADDRESS);
    assert.equal(signed.publicKey, TEST_PUBLIC_KEY);
    assert.equal(signed.signature, TEST_ACCESS_SIGNATURE);
    assert.equal(verifyMessage({
        message: TEST_ACCESS_MESSAGE,
        signature: signed.signature,
        publicKey: signed.publicKey,
        address: signed.address,
    }), true);
    assert.equal(verifyMessage({
        message: `${TEST_ACCESS_MESSAGE}x`,
        signature: signed.signature,
        publicKey: signed.publicKey,
        address: signed.address,
    }), false);
});

test('encrypts and decrypts a saved wallet vault', async () => {
    const record = await encryptMnemonicVault({
        password: 'correct horse battery staple',
        mnemonic: TEST_MNEMONIC,
        iterations: 1000,
        createdAt: '2026-04-30T00:00:00.000Z',
    });

    assert.equal(record.version, 1);
    assert.equal(record.address, TEST_ADDRESS);
    assert.equal(record.derivationPath, DEFAULT_DERIVATION_PATH);
    assert.equal(record.createdAt, '2026-04-30T00:00:00.000Z');
    assert.equal(record.kdf.iterations, 1000);
    assert.equal(record.mnemonic, undefined);

    const mnemonic = await decryptMnemonicVault({
        password: 'correct horse battery staple',
        record,
    });
    assert.equal(mnemonic, TEST_MNEMONIC);

    await assert.rejects(
        decryptMnemonicVault({ password: 'wrong password', record }),
        /operation-specific reason|decrypt|valid/i
    );
});

test('saves, unlocks, and clears the browser wallet vault', async () => {
    const storage = makeStorage();

    const meta = await saveWallet('wallet password', TEST_MNEMONIC, {
        storage,
        iterations: 1000,
        createdAt: '2026-04-30T00:00:00.000Z',
    });
    assert.equal(meta.address, TEST_ADDRESS);
    assert.equal(meta.kdf.iterations, 1000);
    assert.ok(storage.getItem(WALLET_VAULT_STORAGE_KEY));

    assert.equal(getSavedWalletMeta(storage).address, TEST_ADDRESS);

    const unlocked = await unlockSavedWallet('wallet password', { storage });
    assert.equal(unlocked.mnemonic, TEST_MNEMONIC);
    assert.equal(unlocked.wallet.address, TEST_ADDRESS);

    clearSavedWallet(storage);
    assert.equal(storage.getItem(WALLET_VAULT_STORAGE_KEY), null);
});
