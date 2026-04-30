// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const loadContactsModule = () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../../www/common/postfiat-private-share-contacts.js'),
        'utf8'
    );
    let exported;
    vm.runInNewContext(source, {
        define: (deps, factory) => {
            exported = factory();
        },
        console,
    });
    return exported;
};

const createCommon = () => {
    const attrs = {};
    return {
        attrs,
        getAttribute: (pathValue, cb) => cb(null, attrs[pathValue.join('.')]),
        setAttribute: (pathValue, value, cb) => {
            attrs[pathValue.join('.')] = value;
            if (cb) { cb(); }
        },
    };
};

test('stores, lists, updates, and removes Post Fiat private share contacts', async () => {
    const Contacts = loadContactsModule();
    const common = createCommon();
    const publicKeyHex = 'ab'.repeat(32);

    await new Promise((resolve, reject) => {
        Contacts.upsert(common, {
            walletAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
            publicKeyHex,
            relays: ['wss://relay.example/', 'wss://relay.example/'],
        }, (err, contact) => {
            if (err) { return reject(err); }
            assert.equal(contact.walletAddress, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh');
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        Contacts.list(common, (err, contacts) => {
            if (err) { return reject(err); }
            assert.equal(contacts.length, 1);
            assert.deepEqual(contacts[0].relays, ['wss://relay.example/']);
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        Contacts.upsert(common, {
            publicKeyHex,
            relays: ['wss://relay-two.example'],
        }, (err) => err ? reject(err) : resolve());
    });

    await new Promise((resolve, reject) => {
        Contacts.list(common, (err, contacts) => {
            if (err) { return reject(err); }
            assert.equal(contacts.length, 1);
            assert.equal(contacts[0].walletAddress, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh');
            assert.deepEqual(contacts[0].relays, ['wss://relay-two.example']);
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        Contacts.find(common, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', (err, contact) => {
            if (err) { return reject(err); }
            assert.equal(contact.publicKeyHex, publicKeyHex);
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        Contacts.remove(common, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', (err) =>
            err ? reject(err) : resolve());
    });

    await new Promise((resolve, reject) => {
        Contacts.list(common, (err, contacts) => {
            if (err) { return reject(err); }
            assert.equal(contacts.length, 0);
            resolve();
        });
    });
});

test('rejects contacts without a normalized Nostr public key', () => {
    const Contacts = loadContactsModule();
    assert.throws(() => Contacts.normalize({ publicKeyHex: 'nope' }), {
        message: 'INVALID_POSTFIAT_CONTACT_PUBLIC_KEY',
    });
});
