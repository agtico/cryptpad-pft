// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chacha20 } from '@noble/ciphers/chacha.js';
import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
    bytesToHex,
    concatBytes,
    hexToBytes,
    utf8ToBytes,
} from '@noble/hashes/utils.js';

import {
    PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE,
    buildPrivateShareEnvelope,
    parsePrivateShareEnvelope,
    serializePrivateShareEnvelope,
} from './live-pad-share.mjs';
import {
    normalizeNostrPrivateKeyHex,
    normalizeNostrPublicKeyHex,
} from './nostr-identity.mjs';

export const NIP44_VERSION = 2;
export const NIP44_MIN_PLAINTEXT_BYTES = 1;
export const NIP44_MAX_PLAINTEXT_BYTES = 65535;
export const NOSTR_KIND_PRIVATE_DIRECT_MESSAGE = 14;
export const NOSTR_KIND_SEAL = 13;
export const NOSTR_KIND_GIFT_WRAP = 1059;
export const POSTFIAT_PRIVATE_SHARE_TAG = 'cryptpad-private-share';
export const POSTFIAT_PRIVATE_SHARE_TAG_VERSION = '1';
export const TWO_DAYS_SECONDS = 172800;

const textDecoder = new TextDecoder();

const bytesToBase64 = (bytes) => {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const base64ToBytes = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
        throw new Error('INVALID_NIP44_BASE64');
    }
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(normalized, 'base64'));
    }
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const getCrypto = () => {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) {
        throw new Error('WEB_CRYPTO_UNAVAILABLE');
    }
    return cryptoApi;
};

const secureRandomBytes = (length) =>
    getCrypto().getRandomValues(new Uint8Array(length));

const assertBytesLength = (bytes, length, error) => {
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
        throw new Error(error);
    }
};

const privateKeyBytes = (privateKeyHex) =>
    hexToBytes(normalizeNostrPrivateKeyHex(privateKeyHex));

const publicKeyBytes = (publicKeyHex) =>
    hexToBytes(normalizeNostrPublicKeyHex(publicKeyHex));

export const getNostrPublicKeyHex = (privateKeyHex) =>
    bytesToHex(schnorr.getPublicKey(privateKeyBytes(privateKeyHex)));

const liftXOnlyPublicKey = (publicKeyHex) => {
    const normalized = normalizeNostrPublicKeyHex(publicKeyHex);
    const point = schnorr.utils.lift_x(BigInt(`0x${normalized}`));
    return point.toRawBytes(false);
};

export const getNip44ConversationKey = ({
    privateKeyHex,
    publicKeyHex,
} = {}) => {
    const secret = privateKeyBytes(privateKeyHex);
    const publicPoint = liftXOnlyPublicKey(publicKeyHex);
    const sharedPoint = secp256k1.getSharedSecret(secret, publicPoint, false);
    const sharedX = sharedPoint.slice(1, 33);
    return extract(sha256, sharedX, utf8ToBytes('nip44-v2'));
};

export const calcNip44PaddedLength = (unpaddedLength) => {
    if (!Number.isInteger(unpaddedLength) ||
        unpaddedLength < NIP44_MIN_PLAINTEXT_BYTES ||
        unpaddedLength > NIP44_MAX_PLAINTEXT_BYTES) {
        throw new Error('INVALID_NIP44_PLAINTEXT_LENGTH');
    }
    if (unpaddedLength <= 32) { return 32; }
    const nextPower = 1 << (Math.floor(Math.log2(unpaddedLength - 1)) + 1);
    const chunk = nextPower <= 256 ? 32 : nextPower / 8;
    return chunk * (Math.floor((unpaddedLength - 1) / chunk) + 1);
};

export const padNip44Plaintext = (plaintext) => {
    const bytes = utf8ToBytes(String(plaintext));
    const paddedLength = calcNip44PaddedLength(bytes.length);
    const out = new Uint8Array(2 + paddedLength);
    out[0] = (bytes.length >>> 8) & 0xff;
    out[1] = bytes.length & 0xff;
    out.set(bytes, 2);
    return out;
};

export const unpadNip44Plaintext = (padded) => {
    if (!(padded instanceof Uint8Array) || padded.length < 34) {
        throw new Error('INVALID_NIP44_PADDING');
    }
    const unpaddedLength = (padded[0] << 8) | padded[1];
    const expectedLength = 2 + calcNip44PaddedLength(unpaddedLength);
    if (padded.length !== expectedLength ||
        padded.slice(2 + unpaddedLength).some((byte) => byte !== 0)) {
        throw new Error('INVALID_NIP44_PADDING');
    }
    return textDecoder.decode(padded.slice(2, 2 + unpaddedLength));
};

export const getNip44MessageKeys = (conversationKey, nonce) => {
    assertBytesLength(conversationKey, 32, 'INVALID_NIP44_CONVERSATION_KEY');
    assertBytesLength(nonce, 32, 'INVALID_NIP44_NONCE');
    const keys = expand(sha256, conversationKey, nonce, 76);
    return {
        chachaKey: keys.slice(0, 32),
        chachaNonce: keys.slice(32, 44),
        hmacKey: keys.slice(44, 76),
    };
};

const nip44Mac = ({ hmacKey, nonce, ciphertext }) => {
    assertBytesLength(nonce, 32, 'INVALID_NIP44_NONCE');
    return hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
};

const constantTimeEqual = (a, b) => {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
};

export const encryptNip44Payload = ({
    plaintext,
    conversationKey,
    nonce,
} = {}) => {
    const normalizedNonce = nonce || secureRandomBytes(32);
    assertBytesLength(normalizedNonce, 32, 'INVALID_NIP44_NONCE');
    const keys = getNip44MessageKeys(conversationKey, normalizedNonce);
    const ciphertext = chacha20(keys.chachaKey, keys.chachaNonce, padNip44Plaintext(plaintext));
    const mac = nip44Mac({
        hmacKey: keys.hmacKey,
        nonce: normalizedNonce,
        ciphertext,
    });
    return bytesToBase64(concatBytes(
        new Uint8Array([NIP44_VERSION]),
        normalizedNonce,
        ciphertext,
        mac
    ));
};

export const decodeNip44Payload = (payload) => {
    const text = String(payload || '').trim();
    if (!text || text[0] === '#') {
        throw new Error('UNSUPPORTED_NIP44_VERSION');
    }
    if (text.length < 132 || text.length > 87472) {
        throw new Error('INVALID_NIP44_PAYLOAD_SIZE');
    }
    const decoded = base64ToBytes(text);
    if (decoded.length < 99 || decoded.length > 65603) {
        throw new Error('INVALID_NIP44_DATA_SIZE');
    }
    if (decoded[0] !== NIP44_VERSION) {
        throw new Error('UNSUPPORTED_NIP44_VERSION');
    }
    return {
        nonce: decoded.slice(1, 33),
        ciphertext: decoded.slice(33, decoded.length - 32),
        mac: decoded.slice(decoded.length - 32),
    };
};

export const decryptNip44Payload = ({
    payload,
    conversationKey,
} = {}) => {
    const decoded = decodeNip44Payload(payload);
    const keys = getNip44MessageKeys(conversationKey, decoded.nonce);
    const calculatedMac = nip44Mac({
        hmacKey: keys.hmacKey,
        nonce: decoded.nonce,
        ciphertext: decoded.ciphertext,
    });
    if (!constantTimeEqual(calculatedMac, decoded.mac)) {
        throw new Error('INVALID_NIP44_MAC');
    }
    return unpadNip44Plaintext(chacha20(
        keys.chachaKey,
        keys.chachaNonce,
        decoded.ciphertext
    ));
};

export const encryptNip44ToPublicKey = ({
    plaintext,
    senderPrivateKeyHex,
    recipientPublicKeyHex,
    nonce,
} = {}) => encryptNip44Payload({
    plaintext,
    nonce,
    conversationKey: getNip44ConversationKey({
        privateKeyHex: senderPrivateKeyHex,
        publicKeyHex: recipientPublicKeyHex,
    }),
});

export const decryptNip44FromPublicKey = ({
    payload,
    recipientPrivateKeyHex,
    senderPublicKeyHex,
} = {}) => decryptNip44Payload({
    payload,
    conversationKey: getNip44ConversationKey({
        privateKeyHex: recipientPrivateKeyHex,
        publicKeyHex: senderPublicKeyHex,
    }),
});

const normalizeNostrKind = (kind) => {
    const parsed = Number.parseInt(String(kind), 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error('INVALID_NOSTR_KIND');
    }
    return parsed;
};

const normalizeUnixTimestamp = (value) => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('INVALID_NOSTR_CREATED_AT');
    }
    return parsed;
};

const normalizeNostrTags = (tags) => {
    if (!tags) { return []; }
    if (!Array.isArray(tags)) {
        throw new Error('INVALID_NOSTR_TAGS');
    }
    return tags.map((tag) => {
        if (!Array.isArray(tag) || tag.length === 0) {
            throw new Error('INVALID_NOSTR_TAG');
        }
        return tag.map((value) => String(value));
    });
};

export const serializeNostrEventForId = (event) => JSON.stringify([
    0,
    normalizeNostrPublicKeyHex(event.pubkey),
    event.created_at,
    event.kind,
    event.tags || [],
    String(event.content || ''),
]);

export const calculateNostrEventId = (event) =>
    bytesToHex(sha256(utf8ToBytes(serializeNostrEventForId(event))));

export const buildUnsignedNostrEvent = ({
    pubkey,
    kind,
    tags,
    content,
    createdAt,
} = {}) => {
    const event = {
        pubkey: normalizeNostrPublicKeyHex(pubkey),
        created_at: normalizeUnixTimestamp(createdAt),
        kind: normalizeNostrKind(kind),
        tags: normalizeNostrTags(tags),
        content: String(content || ''),
    };
    event.id = calculateNostrEventId(event);
    return event;
};

export const signNostrEvent = (event, privateKeyHex) => {
    const secret = privateKeyBytes(privateKeyHex);
    const pubkey = getNostrPublicKeyHex(privateKeyHex);
    const unsigned = {
        pubkey,
        created_at: normalizeUnixTimestamp(event.created_at),
        kind: normalizeNostrKind(event.kind),
        tags: normalizeNostrTags(event.tags),
        content: String(event.content || ''),
    };
    const id = calculateNostrEventId(unsigned);
    return {
        ...unsigned,
        id,
        sig: bytesToHex(schnorr.sign(hexToBytes(id), secret)),
    };
};

export const verifyNostrEvent = (event) => {
    try {
        const id = calculateNostrEventId(event);
        if (id !== String(event.id || '').toLowerCase()) { return false; }
        return schnorr.verify(
            hexToBytes(String(event.sig || '').toLowerCase()),
            hexToBytes(id),
            publicKeyBytes(event.pubkey)
        );
    } catch (err) {
        return false;
    }
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const randomPastTimestamp = (currentTime, maxPastSeconds = TWO_DAYS_SECONDS) => {
    const current = normalizeUnixTimestamp(currentTime || nowSeconds());
    const bytes = secureRandomBytes(4);
    const randomValue = (
        (bytes[0] << 24) |
        (bytes[1] << 16) |
        (bytes[2] << 8) |
        bytes[3]
    ) >>> 0;
    return current - (randomValue % (maxPastSeconds + 1));
};

const pTag = (publicKeyHex, relay) => {
    const tag = ['p', normalizeNostrPublicKeyHex(publicKeyHex)];
    if (relay) { tag.push(String(relay)); }
    return tag;
};

export const buildPrivateShareRumor = ({
    senderPublicKeyHex,
    recipientPublicKeyHex,
    recipientRelay,
    envelope,
    subject,
    createdAt,
} = {}) => buildUnsignedNostrEvent({
    pubkey: senderPublicKeyHex,
    createdAt,
    kind: NOSTR_KIND_PRIVATE_DIRECT_MESSAGE,
    tags: [
        pTag(recipientPublicKeyHex, recipientRelay),
        ['subject', String(subject || 'Post Fiat CryptPad share')],
        ['postfiat', POSTFIAT_PRIVATE_SHARE_TAG, POSTFIAT_PRIVATE_SHARE_TAG_VERSION],
        ['content-type', PRIVATE_SHARE_ENVELOPE_CONTENT_TYPE],
    ],
    content: serializePrivateShareEnvelope(envelope),
});

export const buildPrivateShareGiftWrap = ({
    senderPrivateKeyHex,
    recipientPublicKeyHex,
    recipientRelay,
    payload,
    envelope,
    subject,
    currentTime,
    rumorCreatedAt,
    sealCreatedAt,
    wrapCreatedAt,
    sealNonce,
    wrapNonce,
    wrapperPrivateKeyHex,
} = {}) => {
    const senderPublicKeyHex = getNostrPublicKeyHex(senderPrivateKeyHex);
    const wrapperSecret = wrapperPrivateKeyHex ||
        bytesToHex(schnorr.utils.randomSecretKey());
    const shareEnvelope = envelope || buildPrivateShareEnvelope(payload);
    const current = currentTime || nowSeconds();
    const rumor = buildPrivateShareRumor({
        senderPublicKeyHex,
        recipientPublicKeyHex,
        recipientRelay,
        envelope: shareEnvelope,
        subject,
        createdAt: rumorCreatedAt || randomPastTimestamp(current),
    });
    const seal = signNostrEvent({
        kind: NOSTR_KIND_SEAL,
        tags: [],
        content: encryptNip44ToPublicKey({
            plaintext: JSON.stringify(rumor),
            senderPrivateKeyHex,
            recipientPublicKeyHex,
            nonce: sealNonce,
        }),
        created_at: sealCreatedAt || randomPastTimestamp(current),
    }, senderPrivateKeyHex);
    const giftWrap = signNostrEvent({
        kind: NOSTR_KIND_GIFT_WRAP,
        tags: [pTag(recipientPublicKeyHex, recipientRelay)],
        content: encryptNip44ToPublicKey({
            plaintext: JSON.stringify(seal),
            senderPrivateKeyHex: wrapperSecret,
            recipientPublicKeyHex,
            nonce: wrapNonce,
        }),
        created_at: wrapCreatedAt || randomPastTimestamp(current),
    }, wrapperSecret);

    return {
        rumor,
        seal,
        giftWrap,
        relays: recipientRelay ? [String(recipientRelay)] : [],
    };
};

export const unwrapPrivateShareGiftWrap = ({
    giftWrap,
    recipientPrivateKeyHex,
} = {}) => {
    if (!giftWrap || giftWrap.kind !== NOSTR_KIND_GIFT_WRAP ||
        !verifyNostrEvent(giftWrap)) {
        throw new Error('INVALID_NOSTR_GIFT_WRAP');
    }
    const seal = JSON.parse(decryptNip44FromPublicKey({
        payload: giftWrap.content,
        recipientPrivateKeyHex,
        senderPublicKeyHex: giftWrap.pubkey,
    }));
    if (!seal || seal.kind !== NOSTR_KIND_SEAL ||
        !Array.isArray(seal.tags) || seal.tags.length !== 0 ||
        !verifyNostrEvent(seal)) {
        throw new Error('INVALID_NOSTR_SEAL');
    }
    const rumor = JSON.parse(decryptNip44FromPublicKey({
        payload: seal.content,
        recipientPrivateKeyHex,
        senderPublicKeyHex: seal.pubkey,
    }));
    if (!rumor || calculateNostrEventId(rumor) !== String(rumor.id || '').toLowerCase()) {
        throw new Error('INVALID_NOSTR_RUMOR');
    }
    if (normalizeNostrPublicKeyHex(rumor.pubkey) !== normalizeNostrPublicKeyHex(seal.pubkey)) {
        throw new Error('NOSTR_RUMOR_SENDER_MISMATCH');
    }
    return {
        giftWrap,
        seal,
        rumor,
        envelope: parsePrivateShareEnvelope(rumor.content),
        senderPublicKeyHex: normalizeNostrPublicKeyHex(seal.pubkey),
        recipientPublicKeyHex: getNostrPublicKeyHex(recipientPrivateKeyHex),
    };
};
