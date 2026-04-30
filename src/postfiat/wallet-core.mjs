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
export const WALLET_VAULT_STORAGE_KEY = 'PFT_wallet_vault';
export const WALLET_VAULT_KDF_ITERATIONS = 250000;
export const WALLET_VAULT_SALT_BYTES = 16;
export const WALLET_VAULT_IV_BYTES = 12;
export const SESSION_WALLET_STORAGE_KEY = 'PFT_session_wallet';
export const SESSION_WALLET_DB_NAME = 'postfiat_session_wallet';
export const SESSION_WALLET_DB_VERSION = 1;
export const SESSION_WALLET_STORE = 'session_keys';
export const SESSION_WALLET_RECORD_KEY = 'active';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
        const request = handler(store);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
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
        await keyStore.delete();
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

export const clearSessionWallet = async (options = {}) => {
    const storage = getSessionStorage(options.storage);
    const keyStore = getSessionKeyStore(options.keyStore);
    storage.removeItem(SESSION_WALLET_STORAGE_KEY);
    await keyStore.delete();
};
