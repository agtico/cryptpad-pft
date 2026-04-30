// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { schnorr, secp256k1 } from '@noble/curves/secp256k1';

import {
    deriveWalletFromMnemonic,
    signMessage,
    verifyMessage,
} from './wallet-core.mjs';

export const NOSTR_IDENTITY_VERSION = 1;
export const DEFAULT_NOSTR_PURPOSE = 'cryptpad-private-sharing';
export const NOSTR_INBOX_DIRECTORY_KIND = 'postfiat-nostr-inbox';
export const NOSTR_INBOX_DIRECTORY_VERSION = 1;
export const NOSTR_PUBLIC_KEY_HEX_LENGTH = 64;

const textEncoder = new TextEncoder();
const walletAddressPattern = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const secp256k1Order = secp256k1.CURVE.n;

const isHex = (value) => /^[0-9a-f]+$/u.test(value);

export const isWalletAddress = (value) =>
    typeof value === 'string' && walletAddressPattern.test(value);

const assertWalletAddress = (value) => {
    if (!isWalletAddress(value)) {
        throw new Error('INVALID_WALLET_ADDRESS');
    }
};

const getCrypto = () => {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) {
        throw new Error('WEB_CRYPTO_UNAVAILABLE');
    }
    return cryptoApi;
};

const bytesToLowerHex = (bytes) =>
    Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const lowerHexToBytes = (hex) => {
    const normalized = String(hex || '').trim().toLowerCase();
    if (normalized.length % 2 !== 0 || !isHex(normalized)) {
        throw new Error('INVALID_HEX');
    }
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
};

const sha256Bytes = async (value) => {
    const digest = await getCrypto().subtle.digest('SHA-256', value);
    return new Uint8Array(digest);
};

const concatBytes = (...chunks) => {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
        out.set(chunk, offset);
        offset += chunk.length;
    });
    return out;
};

const bytesToBigInt = (bytes) => BigInt(`0x${bytesToLowerHex(bytes)}`);

const digestToValidSecp256k1PrivateKey = async (seedBytes) => {
    let digest = await sha256Bytes(seedBytes);
    for (let counter = 0; counter < 256; counter += 1) {
        const scalar = bytesToBigInt(digest);
        if (scalar > 0n && scalar < secp256k1Order) {
            return digest;
        }
        digest = await sha256Bytes(concatBytes(
            seedBytes,
            textEncoder.encode(`\nretry:${counter + 1}`)
        ));
    }
    throw new Error('NOSTR_PRIVATE_KEY_DERIVATION_FAILED');
};

const sortObject = (value) => {
    if (Array.isArray(value)) {
        return value.map(sortObject);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.keys(value).sort().reduce((acc, key) => {
        if (typeof value[key] !== 'undefined') {
            acc[key] = sortObject(value[key]);
        }
        return acc;
    }, {});
};

export const stableStringify = (value) => JSON.stringify(sortObject(value));

export const normalizeNostrPublicKeyHex = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized.length !== NOSTR_PUBLIC_KEY_HEX_LENGTH || !isHex(normalized)) {
        throw new Error('INVALID_NOSTR_PUBLIC_KEY_HEX');
    }
    return normalized;
};

export const normalizeNostrPrivateKeyHex = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized.length !== NOSTR_PUBLIC_KEY_HEX_LENGTH || !isHex(normalized)) {
        throw new Error('INVALID_NOSTR_PRIVATE_KEY_HEX');
    }
    const scalar = bytesToBigInt(lowerHexToBytes(normalized));
    if (scalar <= 0n || scalar >= secp256k1Order) {
        throw new Error('INVALID_NOSTR_PRIVATE_KEY_HEX');
    }
    return normalized;
};

export const normalizeNostrOrigin = (origin) => {
    const fallback = globalThis.location?.origin || 'postfiat://cryptpad';
    const normalized = String(origin || fallback).trim().replace(/\/+$/u, '');
    if (!normalized || /[\u0000-\u001f]/u.test(normalized)) {
        throw new Error('INVALID_NOSTR_ORIGIN');
    }
    return normalized;
};

export const normalizeNostrPurpose = (purpose) => {
    const normalized = String(purpose || DEFAULT_NOSTR_PURPOSE).trim();
    if (!normalized || /[\u0000-\u001f]/u.test(normalized)) {
        throw new Error('INVALID_NOSTR_PURPOSE');
    }
    return normalized;
};

export const buildNostrDerivationMessage = ({
    walletAddress,
    origin,
    purpose,
} = {}) => {
    assertWalletAddress(walletAddress);
    return [
        `Post Fiat Nostr Identity v${NOSTR_IDENTITY_VERSION}`,
        `Wallet: ${walletAddress}`,
        `Origin: ${normalizeNostrOrigin(origin)}`,
        `Purpose: ${normalizeNostrPurpose(purpose)}`,
        'This signature derives a local Nostr key. It is not a transaction.',
    ].join('\n');
};

export const deriveNostrIdentityFromWalletSignature = async ({
    walletAddress,
    walletPublicKey,
    signature,
    message,
    origin,
    purpose,
} = {}) => {
    assertWalletAddress(walletAddress);
    const normalizedOrigin = normalizeNostrOrigin(origin);
    const normalizedPurpose = normalizeNostrPurpose(purpose);
    const expectedMessage = buildNostrDerivationMessage({
        walletAddress,
        origin: normalizedOrigin,
        purpose: normalizedPurpose,
    });
    if (message !== expectedMessage) {
        throw new Error('INVALID_NOSTR_DERIVATION_MESSAGE');
    }
    let validSignature = false;
    try {
        validSignature = verifyMessage({
            message,
            signature,
            publicKey: walletPublicKey,
            address: walletAddress,
        });
    } catch (err) {
        validSignature = false;
    }
    if (!validSignature) {
        throw new Error('INVALID_NOSTR_DERIVATION_SIGNATURE');
    }

    const derivationMaterial = stableStringify({
        domain: 'postfiat.cryptpad.nostr.identity',
        version: NOSTR_IDENTITY_VERSION,
        origin: normalizedOrigin,
        purpose: normalizedPurpose,
        walletAddress,
        walletPublicKey: String(walletPublicKey || '').trim().toUpperCase(),
        walletSignature: String(signature || '').trim().toUpperCase(),
    });
    const privateKeyBytes = await digestToValidSecp256k1PrivateKey(
        textEncoder.encode(derivationMaterial)
    );
    const privateKeyHex = normalizeNostrPrivateKeyHex(bytesToLowerHex(privateKeyBytes));
    const publicKeyHex = normalizeNostrPublicKeyHex(bytesToLowerHex(
        schnorr.getPublicKey(privateKeyBytes)
    ));

    return {
        version: NOSTR_IDENTITY_VERSION,
        walletAddress,
        origin: normalizedOrigin,
        purpose: normalizedPurpose,
        publicKeyHex,
        privateKeyHex,
        derivationMessage: message,
    };
};

export const deriveNostrIdentityFromMnemonic = async (mnemonic, options = {}) => {
    const wallet = deriveWalletFromMnemonic(mnemonic);
    const origin = normalizeNostrOrigin(options.origin);
    const purpose = normalizeNostrPurpose(options.purpose);
    const message = buildNostrDerivationMessage({
        walletAddress: wallet.address,
        origin,
        purpose,
    });
    const signed = signMessage(mnemonic, message);
    return deriveNostrIdentityFromWalletSignature({
        walletAddress: wallet.address,
        walletPublicKey: signed.publicKey,
        signature: signed.signature,
        message,
        origin,
        purpose,
    });
};

export const normalizeNostrRelayUrl = (value) => {
    const text = String(value || '').trim();
    if (!text) { throw new Error('INVALID_NOSTR_RELAY_URL'); }
    let url;
    try {
        url = new URL(text);
    } catch (err) {
        throw new Error('INVALID_NOSTR_RELAY_URL');
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
        throw new Error('INVALID_NOSTR_RELAY_URL');
    }
    if (url.username || url.password) {
        throw new Error('INVALID_NOSTR_RELAY_URL');
    }
    url.hash = '';
    if (url.pathname === '/' && !url.search) {
        return `${url.protocol}//${url.host}`;
    }
    return url.toString().replace(/\/$/u, '');
};

export const normalizeNostrRelayList = (relays) => {
    const values = Array.isArray(relays) ? relays : [relays].filter(Boolean);
    return Array.from(new Set(values.map(normalizeNostrRelayUrl)));
};

const normalizeCreatedAt = (createdAt) => {
    const value = createdAt || new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('INVALID_NOSTR_DIRECTORY_CREATED_AT');
    }
    return date.toISOString();
};

export const buildNostrInboxDirectoryRecord = ({
    walletAddress,
    publicKeyHex,
    relays,
    createdAt,
} = {}) => {
    assertWalletAddress(walletAddress);
    return {
        kind: NOSTR_INBOX_DIRECTORY_KIND,
        version: NOSTR_INBOX_DIRECTORY_VERSION,
        walletAddress,
        publicKeyHex: normalizeNostrPublicKeyHex(publicKeyHex),
        relays: normalizeNostrRelayList(relays),
        createdAt: normalizeCreatedAt(createdAt),
    };
};

export const serializeNostrInboxDirectoryRecord = (record) =>
    stableStringify(buildNostrInboxDirectoryRecord(record));

export const parseNostrInboxDirectoryRecord = (serialized) => {
    const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('INVALID_NOSTR_DIRECTORY_RECORD');
    }
    if (parsed.kind !== NOSTR_INBOX_DIRECTORY_KIND ||
        parsed.version !== NOSTR_INBOX_DIRECTORY_VERSION) {
        throw new Error('UNSUPPORTED_NOSTR_DIRECTORY_RECORD');
    }
    return buildNostrInboxDirectoryRecord(parsed);
};
