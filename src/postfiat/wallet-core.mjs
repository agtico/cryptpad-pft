// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import sodium from 'libsodium-wrappers';
import * as keypairs from 'ripple-keypairs';
import { Wallet } from 'xrpl';

export const DEFAULT_DERIVATION_PATH = "m/44'/144'/0'/0/0";
export const DEFAULT_WORD_COUNT = 24;
export const DEFAULT_ENTROPY_BITS = 256;
export const WALLET_VAULT_STORAGE_KEY = 'PFT_wallet_vault';
export const WALLET_VAULT_KDF_ITERATIONS = 250000;
export const WALLET_VAULT_SALT_BYTES = 16;
export const WALLET_VAULT_IV_BYTES = 12;
export const SESSION_WALLET_STORAGE_KEY = 'PFT_session_wallet';
export const SESSION_WALLET_DB_NAME = 'postfiat_session_wallet';
export const SESSION_WALLET_DB_VERSION = 1;
export const SESSION_WALLET_STORE = 'session_keys';
export const SESSION_WALLET_RECORD_KEY = 'active';
export const SESSION_WALLET_CHANNEL_NAME = 'PFT_core_wallet_session_channel';
export const SESSION_WALLET_REQUEST = 'PFT_CORE_WALLET_SESSION_REQUEST';
export const SESSION_WALLET_RESPONSE = 'PFT_CORE_WALLET_SESSION_RESPONSE';
export const SESSION_WALLET_REQUEST_TIMEOUT_MS = 800;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let sessionWalletResponder;

const TASKNODE_ENC_SUITE = 'ENC_X25519_XCHACHA20P1305';
const TASKNODE_CONTENT_KIND = Object.freeze({
    UNSPECIFIED: 0,
    TASK: 1,
    TASK_UPDATE: 2,
    TASK_SUBMISSION: 3,
    CHAT: 4,
    CONTEXT: 5,
    REWARD: 6,
    POLICY: 7,
    IDENTITY: 8,
    ASSET: 9,
    DOCUMENT: 10,
    SYSTEM: 11,
    TEST: 99,
});
const TASKNODE_KIND_LABELS = Object.freeze(Object.keys(TASKNODE_CONTENT_KIND)
    .reduce((acc, key) => {
        acc[TASKNODE_CONTENT_KIND[key]] = key;
        return acc;
    }, {}));
const TASKNODE_TASK_KINDS = new Set([
    TASKNODE_CONTENT_KIND.TASK,
    TASKNODE_CONTENT_KIND.TASK_UPDATE,
    TASKNODE_CONTENT_KIND.TASK_SUBMISSION,
    TASKNODE_CONTENT_KIND.REWARD,
]);
const RIPPLE_EPOCH_OFFSET = 946684800;
const DEFAULT_TASKNODE_ACCOUNT_TX_LIMIT = 200;
const DEFAULT_TASKNODE_MAX_PAGES = 8;
const DEFAULT_TASKNODE_MAX_TASK_DETAILS = 120;
const DEFAULT_TASKNODE_MAX_CONTEXT_DETAILS = 5;
const DEFAULT_TASKNODE_FETCH_TIMEOUT_MS = 12000;

const getCrypto = () => {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
        throw new Error('WEB_CRYPTO_UNAVAILABLE');
    }
    return cryptoApi;
};

const getStorage = (storage) => {
    if (storage) { return storage; }
    if (globalThis.localStorage) { return globalThis.localStorage; }
    throw new Error('LOCAL_STORAGE_UNAVAILABLE');
};

const getSessionStorage = (storage) => {
    if (storage) { return storage; }
    if (globalThis.sessionStorage) { return globalThis.sessionStorage; }
    throw new Error('SESSION_STORAGE_UNAVAILABLE');
};

const openSessionDb = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
        reject(new Error('INDEXEDDB_UNAVAILABLE'));
        return;
    }
    const request = indexedDB.open(SESSION_WALLET_DB_NAME, SESSION_WALLET_DB_VERSION);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSION_WALLET_STORE)) {
            db.createObjectStore(SESSION_WALLET_STORE);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const transactionRequest = async (mode, handler) => {
    const db = await openSessionDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SESSION_WALLET_STORE, mode);
        const store = tx.objectStore(SESSION_WALLET_STORE);
        let result = null;
        let settled = false;
        const settle = (fn) => {
            if (settled) { return; }
            settled = true;
            try {
                db.close();
            } catch (err) {
                console.error(err);
            }
            fn();
        };

        tx.oncomplete = () => settle(() => resolve(result));
        tx.onerror = () => settle(() => reject(tx.error ||
            new Error('INDEXEDDB_TRANSACTION_ERROR')));
        tx.onabort = () => settle(() => reject(tx.error ||
            new Error('INDEXEDDB_TRANSACTION_ABORTED')));

        let request;
        try {
            request = handler(store);
        } catch (err) {
            try {
                tx.abort();
            } catch (abortErr) {
                console.error(abortErr);
            }
            settle(() => reject(err));
            return;
        }

        request.onsuccess = () => {
            result = typeof(request.result) === 'undefined' ? null : request.result;
        };
        request.onerror = () => {
            try {
                tx.abort();
            } catch (err) {
                console.error(err);
            }
        };
    });
};

const defaultSessionKeyStore = {
    put: (key) => transactionRequest('readwrite', (store) =>
        store.put(key, SESSION_WALLET_RECORD_KEY)),
    get: () => transactionRequest('readonly', (store) =>
        store.get(SESSION_WALLET_RECORD_KEY)),
    delete: () => transactionRequest('readwrite', (store) =>
        store.delete(SESSION_WALLET_RECORD_KEY)),
};

const getSessionKeyStore = (keyStore) => keyStore || defaultSessionKeyStore;

export const bytesToBase64 = (bytes) => {
    const normalized = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof btoa === 'function') {
        let binary = '';
        for (let i = 0; i < normalized.length; i += 1) {
            binary += String.fromCharCode(normalized[i]);
        }
        return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(normalized).toString('base64');
    }
    throw new Error('BASE64_UNAVAILABLE');
};

export const base64ToBytes = (value) => {
    if (typeof atob === 'function') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }
    throw new Error('BASE64_UNAVAILABLE');
};

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

const bytesToLowerHex = (bytes) =>
    Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const isHex = (value) => typeof value === 'string' && value.length % 2 === 0 &&
    /^[0-9a-fA-F]*$/u.test(value);

const hexToBytes = (value) => {
    if (!isHex(value)) { return null; }
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < value.length; i += 2) {
        bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
    }
    return bytes;
};

const hexToUtf8 = (value) => {
    const bytes = hexToBytes(String(value || ''));
    if (!bytes) { return ''; }
    try {
        return textDecoder.decode(bytes);
    } catch (err) {
        return '';
    }
};

const readVarint = (bytes, offset) => {
    let result = 0;
    let shift = 0;
    let pos = offset;
    while (pos < bytes.length) {
        const byte = bytes[pos];
        result |= (byte & 0x7f) << shift;
        pos += 1;
        if ((byte & 0x80) === 0) {
            return { value: result, nextOffset: pos };
        }
        shift += 7;
        if (shift > 35) { return null; }
    }
    return null;
};

const readLengthDelimited = (bytes, offset) => {
    const len = readVarint(bytes, offset);
    if (!len) { return null; }
    const end = len.nextOffset + len.value;
    if (end > bytes.length) { return null; }
    return { data: bytes.subarray(len.nextOffset, end), nextOffset: end };
};

const skipPointerField = (bytes, offset, wireType) => {
    switch (wireType) {
    case 0: {
        const next = readVarint(bytes, offset);
        return next ? next.nextOffset : -1;
    }
    case 1:
        return offset + 8;
    case 2: {
        const field = readLengthDelimited(bytes, offset);
        return field ? field.nextOffset : -1;
    }
    case 5:
        return offset + 4;
    default:
        return -1;
    }
};

const readPointerString = (bytes, offset) => {
    const field = readLengthDelimited(bytes, offset);
    if (!field) { return null; }
    return {
        value: textDecoder.decode(field.data),
        nextOffset: field.nextOffset,
    };
};

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

const getSodium = async () => {
    await sodium.ready;
    return sodium;
};

const sha256Bytes = async (bytes) => {
    if (globalThis.crypto?.subtle?.digest) {
        const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return new Uint8Array(hash);
    }
    const libsodium = await getSodium();
    return libsodium.crypto_generichash(32, bytes);
};

const deriveTaskNodeSeedBytes = async (mnemonic) => {
    const normalized = normalizeMnemonic(mnemonic);
    if (!isValidMnemonic(normalized)) {
        throw new Error('INVALID_MNEMONIC');
    }
    return sha256Bytes(mnemonicToSeedSync(normalized));
};

export const deriveTaskNodeX25519KeypairFromMnemonic = async (mnemonic) => {
    const libsodium = await getSodium();
    const seedBytes = await deriveTaskNodeSeedBytes(mnemonic);
    return libsodium.crypto_box_seed_keypair(seedBytes);
};

export const encodeTaskNodePublicKey = async (publicKeyBytes) =>
    bytesToBase64(publicKeyBytes);

const deriveTaskNodeRecipientId = async (publicKeyBytes) =>
    bytesToLowerHex(await sha256Bytes(publicKeyBytes));

const buildNoTaskNodeKeyShardError = () => {
    const err = new Error('No matching Task Node key shard for this wallet');
    err.code = 'NO_KEY_SHARD';
    return err;
};

export const isTaskNodeEncryptedBlob = (obj) =>
    Boolean(obj && obj.version === 1 && obj.enc === TASKNODE_ENC_SUITE);

export const decryptTaskNodePayload = async ({ blob, mnemonic }) => {
    if (!blob || !mnemonic) {
        throw new Error('MISSING_TASKNODE_DECRYPT_INPUT');
    }
    if (!isTaskNodeEncryptedBlob(blob)) {
        throw new Error('UNSUPPORTED_TASKNODE_PAYLOAD');
    }

    const libsodium = await getSodium();
    const keypair = await deriveTaskNodeX25519KeypairFromMnemonic(mnemonic);
    const recipientId = await deriveTaskNodeRecipientId(keypair.publicKey);
    const recipients = Array.isArray(blob.recipients) ? blob.recipients : [];
    const shard = recipients.find((entry) => entry && entry.recipient_id === recipientId);
    if (!shard) {
        throw buildNoTaskNodeKeyShardError();
    }

    const fileKey = libsodium.crypto_box_open_easy(
        base64ToBytes(shard.encrypted_file_key || ''),
        base64ToBytes(shard.wrap_nonce || ''),
        base64ToBytes(shard.ephemeral_pubkey || ''),
        keypair.privateKey
    );
    const plaintextBytes = libsodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        base64ToBytes(blob.ciphertext || ''),
        null,
        base64ToBytes(blob.nonce || ''),
        fileKey
    );
    if (blob.content_hash && isHex(blob.content_hash)) {
        const contentHash = bytesToLowerHex(await sha256Bytes(plaintextBytes));
        if (contentHash !== String(blob.content_hash).toLowerCase()) {
            throw new Error('TASKNODE_CONTENT_HASH_MISMATCH');
        }
    }
    return textDecoder.decode(plaintextBytes);
};

export const encryptTaskNodePayloadForTests = async ({ plaintext, recipientPublicKeys } = {}) => {
    const libsodium = await getSodium();
    const textBytes = textEncoder.encode(String(plaintext || ''));
    const fileKey = libsodium.randombytes_buf(
        libsodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES
    );
    const nonce = libsodium.randombytes_buf(
        libsodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    );
    const ciphertext = libsodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        textBytes,
        null,
        null,
        nonce,
        fileKey
    );
    const recipients = [];
    const keys = Array.isArray(recipientPublicKeys) ? recipientPublicKeys : [];
    for (let i = 0; i < keys.length; i += 1) {
        const recipientKey = base64ToBytes(keys[i]);
        const ephKeypair = libsodium.crypto_box_keypair();
        const wrapNonce = libsodium.randombytes_buf(libsodium.crypto_box_NONCEBYTES);
        const encryptedFileKey = libsodium.crypto_box_easy(
            fileKey,
            wrapNonce,
            recipientKey,
            ephKeypair.privateKey
        );
        recipients.push({
            recipient_id: await deriveTaskNodeRecipientId(recipientKey),
            ephemeral_pubkey: bytesToBase64(ephKeypair.publicKey),
            wrap_nonce: bytesToBase64(wrapNonce),
            encrypted_file_key: bytesToBase64(encryptedFileKey),
        });
    }
    return {
        version: 1,
        enc: TASKNODE_ENC_SUITE,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
        content_hash: bytesToLowerHex(await sha256Bytes(textBytes)),
        recipients,
    };
};

export const decodeTaskNodePointerMemo = (memoDataHex) => {
    const bytes = hexToBytes(String(memoDataHex || ''));
    if (!bytes) { return null; }

    const pointer = {};
    let offset = 0;
    try {
        while (offset < bytes.length) {
            const tag = readVarint(bytes, offset);
            if (!tag) { break; }
            offset = tag.nextOffset;
            const fieldNumber = tag.value >>> 3;
            const wireType = tag.value & 0x07;

            if (fieldNumber === 1 && wireType === 2) {
                const field = readPointerString(bytes, offset);
                if (!field) { return null; }
                pointer.cid = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 2 && wireType === 0) {
                const field = readVarint(bytes, offset);
                if (!field) { return null; }
                pointer.target = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 3 && wireType === 0) {
                const field = readVarint(bytes, offset);
                if (!field) { return null; }
                pointer.kind = field.value;
                pointer.kindLabel = TASKNODE_KIND_LABELS[field.value] || String(field.value);
                offset = field.nextOffset;
            } else if (fieldNumber === 4 && wireType === 0) {
                const field = readVarint(bytes, offset);
                if (!field) { return null; }
                pointer.schema = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 5 && wireType === 2) {
                const field = readPointerString(bytes, offset);
                if (!field) { return null; }
                pointer.taskId = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 6 && wireType === 2) {
                const field = readPointerString(bytes, offset);
                if (!field) { return null; }
                pointer.threadId = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 7 && wireType === 2) {
                const field = readPointerString(bytes, offset);
                if (!field) { return null; }
                pointer.contextId = field.value;
                offset = field.nextOffset;
            } else if (fieldNumber === 8 && wireType === 0) {
                const field = readVarint(bytes, offset);
                if (!field) { return null; }
                pointer.flags = field.value;
                offset = field.nextOffset;
            } else {
                const next = skipPointerField(bytes, offset, wireType);
                if (next < 0 || next > bytes.length) { return null; }
                offset = next;
            }
        }
    } catch (err) {
        return null;
    }

    return pointer.cid ? pointer : null;
};

const normalizeAccountTxEntry = (entry) => {
    const tx = entry?.tx_json || entry?.tx || entry?.transaction || entry;
    if (!tx) { return null; }
    if (typeof tx === 'string') {
        try {
            return JSON.parse(tx);
        } catch (err) {
            return null;
        }
    }
    return tx;
};

const rippleTimeToIso = (txDate) => {
    if (typeof txDate !== 'number') { return null; }
    const date = new Date((txDate + RIPPLE_EPOCH_OFFSET) * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const extractTaskNodePointerEvents = (transactions, walletAddress) => {
    const rows = Array.isArray(transactions) ? transactions : [];
    const pointers = [];
    rows.forEach((entry) => {
        const tx = normalizeAccountTxEntry(entry);
        if (!tx || !Array.isArray(tx.Memos)) { return; }
        const txHash = tx.hash || tx.Hash || entry?.hash || entry?.tx_hash || null;
        const ledgerIndex = tx.ledger_index || tx.ledgerIndex || entry?.ledger_index || null;
        const createdAt = rippleTimeToIso(tx.date);
        tx.Memos.forEach((memoWrapper, memoIndex) => {
            const memo = memoWrapper?.Memo || memoWrapper || {};
            const memoType = hexToUtf8(memo.MemoType || memo.memo_type || '');
            const memoFormat = hexToUtf8(memo.MemoFormat || memo.memo_format || '');
            if (memoType !== 'pf.ptr' || memoFormat !== 'v4') { return; }
            const pointer = decodeTaskNodePointerMemo(memo.MemoData || memo.memo_data || '');
            if (!pointer || !pointer.cid) { return; }
            pointers.push({
                cid: pointer.cid,
                kind: pointer.kind,
                kindLabel: pointer.kindLabel || TASKNODE_KIND_LABELS[pointer.kind] || '',
                schema: pointer.schema || null,
                flags: pointer.flags || 0,
                taskId: pointer.taskId || null,
                threadId: pointer.threadId || null,
                contextId: pointer.contextId || null,
                txHash,
                ledgerIndex,
                memoIndex,
                createdAt,
                account: tx.Account || null,
                destination: tx.Destination || null,
                direction: tx.Account === walletAddress ? 'outbound' :
                    (tx.Destination === walletAddress ? 'inbound' : 'related'),
            });
        });
    });
    const seen = new Set();
    return pointers.filter((event) => {
        const key = [
            event.txHash || 'nohash',
            event.memoIndex,
            event.cid,
            event.kind,
            event.taskId || '',
        ].join(':');
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    }).sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        if (aTime !== bTime) { return bTime - aTime; }
        return (b.ledgerIndex || 0) - (a.ledgerIndex || 0);
    });
};

const buildTaskNodeProxyUrl = (path, params) => {
    const query = Object.keys(params || {}).filter((key) => params[key] !== undefined &&
        params[key] !== null && params[key] !== '').map((key) =>
        encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key]))
    ).join('&');
    return path + (query ? '?' + query : '');
};

const fetchJsonWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = Number(options.timeoutMs) > 0 ?
        Math.floor(Number(options.timeoutMs)) : DEFAULT_TASKNODE_FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
            signal: controller.signal,
            cache: 'no-store',
        });
        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (err) {
                throw new Error('INVALID_JSON_RESPONSE');
            }
        }
        if (!response.ok) {
            throw new Error(payload?.error || `HTTP_${response.status}`);
        }
        return payload;
    } finally {
        clearTimeout(timer);
    }
};

const fetchTaskNodeAccountTxPage = async ({ walletAddress, marker, limit, timeoutMs } = {}) => {
    const url = buildTaskNodeProxyUrl(
        `/api/postfiat/pftl/account-tx/${encodeURIComponent(walletAddress)}`,
        {
            limit: limit || DEFAULT_TASKNODE_ACCOUNT_TX_LIMIT,
            marker: marker ? JSON.stringify(marker) : '',
        }
    );
    return fetchJsonWithTimeout(url, { timeoutMs });
};

const fetchTaskNodeAccountTx = async ({ walletAddress, limit, maxPages, timeoutMs } = {}) => {
    let marker = null;
    const pages = [];
    const transactions = [];
    const pageLimit = Number.isInteger(limit) && limit > 0 ?
        limit : DEFAULT_TASKNODE_ACCOUNT_TX_LIMIT;
    const pageMax = Number.isInteger(maxPages) && maxPages > 0 ?
        maxPages : DEFAULT_TASKNODE_MAX_PAGES;
    for (let pageIndex = 0; pageIndex < pageMax; pageIndex += 1) {
        const page = await fetchTaskNodeAccountTxPage({
            walletAddress,
            marker,
            limit: pageLimit,
            timeoutMs,
        });
        const result = page?.result || page || {};
        const txs = result.transactions || result.tx || [];
        if (Array.isArray(txs)) {
            transactions.push(...txs);
        }
        pages.push({
            count: Array.isArray(txs) ? txs.length : 0,
            marker: result.marker || null,
        });
        marker = result.marker || null;
        if (!marker) { break; }
    }
    return { transactions, pages, complete: !marker, nextMarker: marker };
};

const fetchTaskNodeIpfsJson = async ({ cid, timeoutMs } = {}) => {
    const url = `/api/postfiat/ipfs/${encodeURIComponent(cid)}`;
    const response = await fetchJsonWithTimeout(url, { timeoutMs });
    return response && Object.prototype.hasOwnProperty.call(response, 'payload') ?
        response.payload : response;
};

const parseMaybeJson = (text) => {
    if (typeof text !== 'string') { return text; }
    try {
        return JSON.parse(text);
    } catch (err) {
        return text;
    }
};

const summarizeTaskPayload = (payload) => {
    const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const artifacts = Array.isArray(obj.artifacts) ? obj.artifacts : [];
    const firstArtifact = artifacts[0] || {};
    return {
        taskId: obj.task_id || obj.taskId || null,
        phase: obj.phase || '',
        verificationType: obj.verification_type || obj.verificationType ||
            firstArtifact.evidence_type || '',
        createdAt: obj.created_at || obj.createdAt || null,
        artifactCount: artifacts.length || (obj.artifact ? 1 : 0),
        preview: obj.response || obj.response_text || obj.responseText ||
            obj.artifact?.response || firstArtifact.artifact?.response ||
            obj.artifact?.url || firstArtifact.artifact?.url ||
            obj.artifact?.repoUrl || firstArtifact.artifact?.repoUrl || '',
    };
};

const hydratePointerEvents = async ({
    events,
    mnemonic,
    maxDetails,
    timeoutMs,
} = {}) => {
    const rows = [];
    const failures = [];
    const limit = Math.max(0, Number.isInteger(maxDetails) ? maxDetails : 0);
    const selected = (Array.isArray(events) ? events : []).slice(0, limit);
    for (let i = 0; i < selected.length; i += 1) {
        const event = selected[i];
        try {
            const blob = await fetchTaskNodeIpfsJson({ cid: event.cid, timeoutMs });
            let plaintext = null;
            let payload = blob;
            if (isTaskNodeEncryptedBlob(blob)) {
                plaintext = await decryptTaskNodePayload({ blob, mnemonic });
                payload = parseMaybeJson(plaintext);
            }
            rows.push({
                ...event,
                payload,
                plaintext,
                decrypted: plaintext !== null,
                summary: summarizeTaskPayload(payload),
            });
        } catch (err) {
            failures.push({
                cid: event.cid,
                txHash: event.txHash,
                taskId: event.taskId,
                kind: event.kindLabel,
                error: err?.message || String(err),
            });
            rows.push({
                ...event,
                payload: null,
                plaintext: null,
                decrypted: false,
                error: err?.message || String(err),
                summary: {},
            });
        }
    }
    return { rows, failures };
};

const groupTaskHistoryRows = (events) => {
    const grouped = new Map();
    events.forEach((event) => {
        const summary = event.summary || {};
        const taskId = event.taskId || summary.taskId || event.contextId ||
            `cid:${event.cid}`;
        if (!grouped.has(taskId)) {
            grouped.set(taskId, {
                taskId,
                latestAt: event.createdAt || summary.createdAt || null,
                events: [],
                latest: event,
            });
        }
        const row = grouped.get(taskId);
        row.events.push(event);
        const eventTime = Date.parse(event.createdAt || summary.createdAt || '') || 0;
        const latestTime = Date.parse(row.latestAt || '') || 0;
        if (eventTime >= latestTime) {
            row.latestAt = event.createdAt || summary.createdAt || row.latestAt;
            row.latest = event;
        }
    });
    return Array.from(grouped.values()).sort((a, b) => {
        const aTime = Date.parse(a.latestAt || '') || 0;
        const bTime = Date.parse(b.latestAt || '') || 0;
        return bTime - aTime;
    });
};

export const loadTaskNodeHistory = async ({
    mnemonic,
    walletAddress,
    accountTxLimit = DEFAULT_TASKNODE_ACCOUNT_TX_LIMIT,
    maxPages = DEFAULT_TASKNODE_MAX_PAGES,
    maxTaskDetails = DEFAULT_TASKNODE_MAX_TASK_DETAILS,
    maxContextDetails = DEFAULT_TASKNODE_MAX_CONTEXT_DETAILS,
    timeoutMs = DEFAULT_TASKNODE_FETCH_TIMEOUT_MS,
} = {}) => {
    if (!mnemonic) {
        throw new Error('POSTFIAT_WALLET_SESSION_REQUIRED');
    }
    const wallet = deriveWalletFromMnemonic(mnemonic);
    const address = walletAddress || wallet.address;
    if (address !== wallet.address) {
        throw new Error('POSTFIAT_WALLET_ACCOUNT_MISMATCH');
    }

    const txHistory = await fetchTaskNodeAccountTx({
        walletAddress: address,
        limit: accountTxLimit,
        maxPages,
        timeoutMs,
    });
    const pointerEvents = extractTaskNodePointerEvents(txHistory.transactions, address);
    const contextEvents = pointerEvents.filter((event) =>
        event.kind === TASKNODE_CONTENT_KIND.CONTEXT
    );
    const taskPointerEvents = pointerEvents.filter((event) =>
        TASKNODE_TASK_KINDS.has(event.kind) || event.taskId
    );

    const taskHydration = await hydratePointerEvents({
        events: taskPointerEvents,
        mnemonic,
        maxDetails: maxTaskDetails,
        timeoutMs,
    });
    const contextHydration = await hydratePointerEvents({
        events: contextEvents,
        mnemonic,
        maxDetails: maxContextDetails,
        timeoutMs,
    });
    const taskDetailLimit = Math.max(0, Number.isInteger(maxTaskDetails) ?
        maxTaskDetails : DEFAULT_TASKNODE_MAX_TASK_DETAILS);
    const taskRows = taskHydration.rows.concat(taskPointerEvents.slice(taskDetailLimit)
        .map((event) => ({
            ...event,
            payload: null,
            plaintext: null,
            decrypted: false,
            summary: {},
            detailDeferred: true,
        })));
    const latestContext = contextHydration.rows[0] || null;

    return {
        walletAddress: address,
        scannedTransactions: txHistory.transactions.length,
        accountTxPages: txHistory.pages,
        accountTxComplete: txHistory.complete,
        pointerCount: pointerEvents.length,
        taskEventCount: taskPointerEvents.length,
        contextUpdateCount: contextEvents.length,
        tasks: groupTaskHistoryRows(taskRows),
        taskEvents: taskRows,
        taskHydrationFailures: taskHydration.failures,
        contextUpdates: contextEvents,
        contextDetails: contextHydration.rows,
        contextHydrationFailures: contextHydration.failures,
        latestContext: latestContext ? {
            cid: latestContext.cid,
            txHash: latestContext.txHash,
            ledgerIndex: latestContext.ledgerIndex,
            createdAt: latestContext.createdAt,
            text: typeof latestContext.payload === 'string' ?
                latestContext.payload : latestContext.plaintext,
            payload: latestContext.payload,
            decrypted: latestContext.decrypted,
            error: latestContext.error || null,
        } : null,
        source: {
            accountTx: '/api/postfiat/pftl/account-tx',
            ipfs: '/api/postfiat/ipfs',
        },
    };
};

const deriveVaultKey = async ({ password, salt, iterations }) => {
    if (!password) {
        throw new Error('MISSING_WALLET_PASSWORD');
    }
    const cryptoApi = getCrypto();
    const keyMaterial = await cryptoApi.subtle.importKey(
        'raw',
        textEncoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return cryptoApi.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

export const encryptMnemonicVault = async ({ password, mnemonic, iterations, createdAt } = {}) => {
    const wallet = deriveWalletFromMnemonic(mnemonic);
    const normalizedIterations = iterations || WALLET_VAULT_KDF_ITERATIONS;
    const cryptoApi = getCrypto();
    const salt = cryptoApi.getRandomValues(new Uint8Array(WALLET_VAULT_SALT_BYTES));
    const iv = cryptoApi.getRandomValues(new Uint8Array(WALLET_VAULT_IV_BYTES));
    const key = await deriveVaultKey({ password, salt, iterations: normalizedIterations });
    const payload = {
        mnemonic: wallet.mnemonic,
        address: wallet.address,
        derivationPath: wallet.derivationPath,
    };
    const ciphertext = await cryptoApi.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        textEncoder.encode(JSON.stringify(payload))
    );

    return {
        version: 1,
        address: wallet.address,
        derivationPath: wallet.derivationPath,
        createdAt: createdAt || new Date().toISOString(),
        kdf: {
            name: 'PBKDF2',
            hash: 'SHA-256',
            iterations: normalizedIterations,
            salt: bytesToBase64(salt),
        },
        cipher: {
            name: 'AES-GCM',
            iv: bytesToBase64(iv),
        },
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
};

export const decryptMnemonicVault = async ({ password, record } = {}) => {
    if (!record || record.version !== 1) {
        throw new Error('INVALID_WALLET_VAULT');
    }
    const cryptoApi = getCrypto();
    const salt = base64ToBytes(record.kdf?.salt || '');
    const iv = base64ToBytes(record.cipher?.iv || '');
    const ciphertext = base64ToBytes(record.ciphertext || '');
    const key = await deriveVaultKey({
        password,
        salt,
        iterations: record.kdf?.iterations || WALLET_VAULT_KDF_ITERATIONS,
    });
    const plaintext = await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );
    const payload = JSON.parse(textDecoder.decode(plaintext));
    const wallet = deriveWalletFromMnemonic(payload.mnemonic);
    if (record.address && wallet.address !== record.address) {
        throw new Error('WALLET_VAULT_ADDRESS_MISMATCH');
    }
    return wallet.mnemonic;
};

export const getSavedWalletRecord = (storage) => {
    const store = getStorage(storage);
    const raw = store.getItem(WALLET_VAULT_STORAGE_KEY);
    if (!raw) { return null; }
    return JSON.parse(raw);
};

export const getSavedWalletMeta = (storage) => {
    const record = getSavedWalletRecord(storage);
    if (!record) { return null; }
    return {
        version: record.version,
        address: record.address,
        derivationPath: record.derivationPath,
        createdAt: record.createdAt,
        kdf: record.kdf && {
            name: record.kdf.name,
            hash: record.kdf.hash,
            iterations: record.kdf.iterations,
        },
    };
};

export const hasSavedWallet = (storage) => Boolean(getSavedWalletMeta(storage));

export const saveWallet = async (password, mnemonic, options = {}) => {
    const store = getStorage(options.storage);
    const record = await encryptMnemonicVault({
        password,
        mnemonic,
        iterations: options.iterations,
        createdAt: options.createdAt,
    });
    store.setItem(WALLET_VAULT_STORAGE_KEY, JSON.stringify(record));
    return getSavedWalletMeta(store);
};

export const unlockSavedWallet = async (password, options = {}) => {
    const store = getStorage(options.storage);
    const record = getSavedWalletRecord(store);
    if (!record) {
        throw new Error('NO_SAVED_WALLET');
    }
    const mnemonic = await decryptMnemonicVault({ password, record });
    return {
        mnemonic,
        wallet: deriveWalletFromMnemonic(mnemonic),
        meta: getSavedWalletMeta(store),
    };
};

export const clearSavedWallet = (storage) => {
    const store = getStorage(storage);
    store.removeItem(WALLET_VAULT_STORAGE_KEY);
};

export const createSessionWallet = async (mnemonic, options = {}) => {
    const wallet = deriveWalletFromMnemonic(mnemonic);
    const cryptoApi = getCrypto();
    const storage = getSessionStorage(options.storage);
    const keyStore = getSessionKeyStore(options.keyStore);
    const key = await cryptoApi.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
    const iv = cryptoApi.getRandomValues(new Uint8Array(WALLET_VAULT_IV_BYTES));
    const payload = {
        mnemonic: wallet.mnemonic,
        address: wallet.address,
        derivationPath: wallet.derivationPath,
        createdAt: options.createdAt || new Date().toISOString(),
    };
    const ciphertext = await cryptoApi.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        textEncoder.encode(JSON.stringify(payload))
    );

    await keyStore.put(key);
    storage.setItem(SESSION_WALLET_STORAGE_KEY, JSON.stringify({
        version: 1,
        address: wallet.address,
        derivationPath: wallet.derivationPath,
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    }));

    return {
        address: wallet.address,
        derivationPath: wallet.derivationPath,
    };
};

export const restoreSessionWallet = async (options = {}) => {
    const cryptoApi = getCrypto();
    const storage = getSessionStorage(options.storage);
    const keyStore = getSessionKeyStore(options.keyStore);
    const raw = storage.getItem(SESSION_WALLET_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    try {
        const record = JSON.parse(raw);
        if (!record || record.version !== 1) {
            throw new Error('INVALID_SESSION_WALLET');
        }
        const key = await keyStore.get();
        if (!key) {
            storage.removeItem(SESSION_WALLET_STORAGE_KEY);
            return null;
        }
        const plaintext = await cryptoApi.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToBytes(record.iv || '') },
            key,
            base64ToBytes(record.ciphertext || '')
        );
        const payload = JSON.parse(textDecoder.decode(plaintext));
        const wallet = deriveWalletFromMnemonic(payload.mnemonic);
        if (record.address && wallet.address !== record.address) {
            throw new Error('SESSION_WALLET_ADDRESS_MISMATCH');
        }
        return {
            mnemonic: wallet.mnemonic,
            wallet,
        };
    } catch (err) {
        storage.removeItem(SESSION_WALLET_STORAGE_KEY);
        await keyStore.delete();
        throw err;
    }
};

export const stopSessionWalletResponder = () => {
    if (!sessionWalletResponder) { return; }
    try {
        sessionWalletResponder.close();
    } catch (err) {
        console.error(err);
    }
    sessionWalletResponder = undefined;
};

export const clearSessionWallet = async (options = {}) => {
    const storage = getSessionStorage(options.storage);
    const keyStore = getSessionKeyStore(options.keyStore);
    storage.removeItem(SESSION_WALLET_STORAGE_KEY);
    await keyStore.delete();
    stopSessionWalletResponder();
};

export const startSessionWalletResponder = (options = {}) => {
    void options;
    stopSessionWalletResponder();
    return false;
};

export const requestSessionWallet = (options = {}) => {
    void options;
    return Promise.resolve(null);
};
