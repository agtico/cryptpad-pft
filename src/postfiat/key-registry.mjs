// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MESSAGE_KEY_X25519_PREFIX = 'ED';
export const DOMAIN_X25519_PREFIX = 'x25519:';
export const X25519_PUBLIC_KEY_BYTES = 32;
export const X25519_PUBLIC_KEY_HEX_LENGTH = X25519_PUBLIC_KEY_BYTES * 2;
export const DEFAULT_PFTL_NETWORK_ID = 2025;

const isHex = (value) => /^[0-9a-f]+$/iu.test(value);
const walletAddressPattern = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export const isWalletAddress = (value) =>
    typeof value === 'string' && walletAddressPattern.test(value);

export const normalizeNetworkId = (value, fallback = DEFAULT_PFTL_NETWORK_ID) => {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 4294967295) {
        return parsed;
    }
    return fallback;
};

const bytesToBase64 = (bytes) => {
    const normalized = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(normalized).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < normalized.length; i += 1) {
        binary += String.fromCharCode(normalized[i]);
    }
    return btoa(binary);
};

const base64ToBytes = (value) => {
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

export const normalizeX25519PublicKeyHex = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized.length !== X25519_PUBLIC_KEY_HEX_LENGTH || !isHex(normalized)) {
        throw new Error('INVALID_X25519_PUBLIC_KEY_HEX');
    }
    return normalized;
};

export const x25519PublicKeyHexToBase64 = (hex) => {
    const normalized = normalizeX25519PublicKeyHex(hex);
    const bytes = new Uint8Array(X25519_PUBLIC_KEY_BYTES);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
    return bytesToBase64(bytes);
};

export const x25519PublicKeyBase64ToHex = (base64) => {
    const bytes = base64ToBytes(String(base64 || '').trim());
    if (bytes.length !== X25519_PUBLIC_KEY_BYTES) {
        throw new Error('INVALID_X25519_PUBLIC_KEY_BASE64');
    }
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
};

export const parseMessageKeyX25519 = (messageKey) => {
    const normalized = String(messageKey || '').trim().toUpperCase();
    if (!normalized) { return null; }
    if (!normalized.startsWith(MESSAGE_KEY_X25519_PREFIX)) { return null; }
    const keyHex = normalized.slice(MESSAGE_KEY_X25519_PREFIX.length);
    return {
        source: 'messageKey',
        publicKeyHex: normalizeX25519PublicKeyHex(keyHex),
        publicKeyBase64: x25519PublicKeyHexToBase64(keyHex),
    };
};

export const parseDomainX25519 = (domain) => {
    const text = String(domain || '').trim();
    const match = text.match(/(?:^|[;\s])x25519:([A-Za-z0-9+/=]{43,44})(?:$|[;\s])/u);
    if (!match) { return null; }
    const publicKeyHex = x25519PublicKeyBase64ToHex(match[1]);
    return {
        source: 'domain',
        publicKeyHex,
        publicKeyBase64: bytesToBase64(base64ToBytes(match[1])),
    };
};

export const selectRecipientX25519Key = ({ messageKey, domain } = {}) => {
    const fromMessageKey = parseMessageKeyX25519(messageKey);
    if (fromMessageKey) { return fromMessageKey; }
    return parseDomainX25519(domain);
};

export const buildMessageKeyValue = (x25519PublicKeyHex) =>
    `${MESSAGE_KEY_X25519_PREFIX}${normalizeX25519PublicKeyHex(x25519PublicKeyHex)}`;

export const buildDomainValue = (x25519PublicKeyBase64) =>
    `${DOMAIN_X25519_PREFIX}${bytesToBase64(base64ToBytes(x25519PublicKeyBase64))}`;

export const buildMessageKeyAccountSet = ({
    account,
    x25519PublicKeyHex,
    networkId,
} = {}) => {
    if (!isWalletAddress(account)) {
        throw new Error('INVALID_ACCOUNT_WALLET');
    }
    const tx = {
        TransactionType: 'AccountSet',
        Account: account,
        MessageKey: buildMessageKeyValue(x25519PublicKeyHex),
    };
    const normalizedNetworkId = normalizeNetworkId(networkId, null);
    if (normalizedNetworkId !== null) {
        tx.NetworkID = normalizedNetworkId;
    }
    return tx;
};
