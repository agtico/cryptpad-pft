// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as keypairs from 'ripple-keypairs';
import { Wallet } from 'xrpl';

export const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
export const DEFAULT_WORD_COUNT = 24;
export const DEFAULT_ENTROPY_BITS = 256;

const textEncoder = new TextEncoder();

export const normalizeMnemonic = (mnemonic) =>
    String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const createMnemonic = () => generateMnemonic(wordlist, DEFAULT_ENTROPY_BITS);

export const isValidMnemonic = (mnemonic) =>
    validateMnemonic(normalizeMnemonic(mnemonic), wordlist);

export const deriveWalletFromMnemonic = (mnemonic) => {
    const normalized = normalizeMnemonic(mnemonic);
    if (!isValidMnemonic(normalized)) {
        throw new Error('INVALID_MNEMONIC');
    }

    const wallet = Wallet.fromMnemonic(normalized, {
        mnemonicEncoding: 'bip39',
        derivationPath: DEFAULT_DERIVATION_PATH,
    });

    return {
        mnemonic: normalized,
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
        address: wallet.classicAddress,
        derivationPath: DEFAULT_DERIVATION_PATH,
    };
};

export const bytesToHex = (bytes) =>
    Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

export const messageToHex = (message) => bytesToHex(textEncoder.encode(String(message)));

export const signMessage = (mnemonic, message) => {
    const wallet = deriveWalletFromMnemonic(mnemonic);
    const messageHex = messageToHex(message);
    const signature = keypairs.sign(messageHex, wallet.privateKey);

    return {
        address: wallet.address,
        publicKey: wallet.publicKey,
        signature,
        messageHex,
    };
};

export const verifyMessage = ({ message, signature, publicKey, address }) => {
    if (address && keypairs.deriveAddress(publicKey) !== address) {
        return false;
    }
    return keypairs.verify(messageToHex(message), signature, publicKey);
};
