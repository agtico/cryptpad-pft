// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const LIVE_PAD_SHARE_KIND = 'cryptpad-live-pad';
export const LIVE_PAD_SHARE_VERSION = 1;
export const LIVE_PAD_SHARE_CONTENT_TYPE = 'application/vnd.postfiat.cryptpad-live-pad+json;version=1';
export const LIVE_PAD_SHARE_MODES = Object.freeze(['edit', 'view']);
export const PRIVATE_SHARE_ENVELOPE_VERSION = 1;
export const PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE = 'application/vnd.postfiat.cryptpad-private-share-envelope+json;version=1';
export const PRIVATE_SHARE_TRANSPORTS = Object.freeze(['nostr']);
export const PFTL_CONTENT_ENVELOPE_VERSION = 1;

const walletAddressPattern = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export const isWalletAddress = (value) =>
    typeof value === 'string' && walletAddressPattern.test(value);

const assertWalletAddress = (value, name) => {
    if (!isWalletAddress(value)) {
        throw new Error(`INVALID_${name.toUpperCase()}_WALLET`);
    }
};

const normalizeMode = (mode) => {
    const normalized = String(mode || 'edit').trim().toLowerCase();
    if (!LIVE_PAD_SHARE_MODES.includes(normalized)) {
        throw new Error('INVALID_LIVE_PAD_SHARE_MODE');
    }
    return normalized;
};

const normalizeHref = (href) => {
    const normalized = String(href || '').trim();
    if (!normalized) { throw new Error('MISSING_LIVE_PAD_HREF'); }
    if (/[\u0000-\u001f]/u.test(normalized)) {
        throw new Error('INVALID_LIVE_PAD_HREF');
    }
    if (!/^(\/|https?:\/\/)/u.test(normalized)) {
        throw new Error('INVALID_LIVE_PAD_HREF');
    }
    return normalized;
};

const normalizeTitle = (title) => {
    const normalized = String(title || '').trim();
    return normalized || 'Untitled document';
};

const normalizeCreatedAt = (createdAt) => {
    const value = createdAt || new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('INVALID_LIVE_PAD_CREATED_AT');
    }
    return date.toISOString();
};

const normalizeTransport = (transport) => {
    const normalized = String(transport || 'nostr').trim().toLowerCase();
    if (!PRIVATE_SHARE_TRANSPORTS.includes(normalized)) {
        throw new Error('INVALID_PRIVATE_SHARE_TRANSPORT');
    }
    return normalized;
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

export const buildLivePadSharePayload = ({
    href,
    title,
    mode,
    ownerWallet,
    sharedByWallet,
    createdAt,
    metadata,
} = {}) => {
    const payload = {
        kind: LIVE_PAD_SHARE_KIND,
        version: LIVE_PAD_SHARE_VERSION,
        href: normalizeHref(href),
        title: normalizeTitle(title),
        mode: normalizeMode(mode),
        createdAt: normalizeCreatedAt(createdAt),
    };

    if (ownerWallet) {
        assertWalletAddress(ownerWallet, 'owner');
        payload.ownerWallet = ownerWallet;
    }
    if (sharedByWallet) {
        assertWalletAddress(sharedByWallet, 'shared_by');
        payload.sharedByWallet = sharedByWallet;
    }
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        payload.metadata = sortObject(metadata);
    }

    return payload;
};

export const serializeLivePadSharePayload = (payload) =>
    stableStringify(buildLivePadSharePayload(payload));

export const parseLivePadSharePayload = (serialized) => {
    const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('INVALID_LIVE_PAD_SHARE_PAYLOAD');
    }
    if (parsed.kind !== LIVE_PAD_SHARE_KIND || parsed.version !== LIVE_PAD_SHARE_VERSION) {
        throw new Error('UNSUPPORTED_LIVE_PAD_SHARE_PAYLOAD');
    }
    return buildLivePadSharePayload(parsed);
};

export const buildPrivateShareEnvelope = (payload, options = {}) => ({
    envelopeVersion: PRIVATE_SHARE_ENVELOPE_VERSION,
    envelopeContentType: PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE,
    transport: normalizeTransport(options.transport),
    contentType: LIVE_PAD_SHARE_CONTENT_TYPE,
    plaintext: serializeLivePadSharePayload(payload),
    createdAt: normalizeCreatedAt(options.createdAt),
});

export const buildPftlContentEnvelope = (payload) => ({
    envelopeVersion: PFTL_CONTENT_ENVELOPE_VERSION,
    transport: 'pftl',
    contentType: LIVE_PAD_SHARE_CONTENT_TYPE,
    plaintext: serializeLivePadSharePayload(payload),
});
