// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const Constants = require(path.join(repoRoot, 'src/common/common-constants.js'));
const localStoreSource = fs.readFileSync(
    path.join(repoRoot, 'www/common/outer/local-store.js'),
    'utf8'
);

const makeStorage = () => ({
    setItem(key, value) {
        this[String(key)] = String(value);
    },
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this, String(key)) ?
            this[String(key)] : null;
    },
    removeItem(key) {
        delete this[String(key)];
    },
    clear() {
        Object.keys(this).forEach((key) => {
            if (typeof this[key] !== 'function') {
                delete this[key];
            }
        });
    },
});

const loadLocalStore = () => {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    let LocalStore;
    const context = {
        console,
        localStorage,
        sessionStorage,
        window: {},
        define(_deps, factory) {
            LocalStore = factory(
                Constants,
                { serializeHash: (hash) => hash, createRandomHash: () => '/anon/hash/' },
                { clear: (cb) => cb && cb() },
                { setItem() {}, getItem() {}, clear(cb) { if (cb) { cb(); } } },
                {},
                { once: (fn) => {
                    let called = false;
                    return (...args) => {
                        if (called) { return; }
                        called = true;
                        return fn(...args);
                    };
                } }
            );
        },
    };
    vm.createContext(context);
    vm.runInContext(localStoreSource, context);
    return { LocalStore, localStorage, sessionStorage, window: context.window };
};

test('password logins keep CryptPad persistent local storage behavior', () => {
    const { LocalStore, localStorage, sessionStorage } = loadLocalStore();

    LocalStore.login(undefined, 'persistent-block', 'alice');

    assert.equal(LocalStore.isLoggedIn(), true);
    assert.equal(LocalStore.getBlockHash(), 'persistent-block');
    assert.equal(LocalStore.getAccountName(), 'alice');
    assert.equal(localStorage[Constants.blockHashKey], 'persistent-block');
    assert.equal(sessionStorage[Constants.blockHashKey], undefined);
});

test('stale persisted wallet-looking logins do not auto-unlock', () => {
    const { LocalStore, localStorage } = loadLocalStore();

    localStorage[Constants.userNameKey] = 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC';
    localStorage[Constants.blockHashKey] = 'old-wallet-block';

    assert.equal(LocalStore.isLoggedIn(), false);
    assert.equal(LocalStore.getBlockHash(), undefined);
    assert.equal(LocalStore.getAccountName(), undefined);
});

test('wallet logins store the login capability in session storage only', () => {
    const { LocalStore, localStorage, sessionStorage } = loadLocalStore();

    LocalStore.walletLogin(undefined, 'wallet-block', 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC');

    assert.equal(LocalStore.isWalletSession(), true);
    assert.equal(LocalStore.isLoggedIn(), true);
    assert.equal(LocalStore.getBlockHash(), 'wallet-block');
    assert.equal(LocalStore.getAccountName(), 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC');
    assert.equal(localStorage[Constants.blockHashKey], undefined);
    assert.equal(localStorage[Constants.userNameKey], undefined);
    assert.equal(sessionStorage[Constants.blockHashKey], 'wallet-block');
});

test('wallet lock clears only the current wallet session', () => {
    const { LocalStore, sessionStorage } = loadLocalStore();

    LocalStore.walletLogin(undefined, 'wallet-block', 'rKxpJQ6hLWYbo7p1oo7WHjrcrRFv1TUQeC');
    LocalStore.lockWallet();

    assert.equal(LocalStore.isWalletSession(), false);
    assert.equal(LocalStore.isLoggedIn(), false);
    assert.equal(sessionStorage[Constants.blockHashKey], undefined);
});
