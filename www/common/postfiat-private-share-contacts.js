// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([], function () {
    var Contacts = {};
    var ATTR_PATH = ['postFiat', 'privateShareContacts'];
    var publicKeyPattern = /^[0-9a-f]{64}$/u;

    var normalizeRelayList = function (relays) {
        var values = Array.isArray(relays) ? relays : [relays].filter(Boolean);
        var seen = {};
        return values.map(function (relay) {
            return String(relay || '').trim();
        }).filter(function (relay) {
            if (!relay || seen[relay]) { return false; }
            seen[relay] = true;
            return true;
        });
    };

    var normalizeContact = Contacts.normalize = function (input) {
        input = input || {};
        var publicKeyHex = String(input.publicKeyHex || input.pubkey || '').trim().toLowerCase();
        if (!publicKeyPattern.test(publicKeyHex)) {
            throw new Error('INVALID_POSTFIAT_CONTACT_PUBLIC_KEY');
        }
        var walletAddress = String(input.walletAddress || '').trim();
        var relays = normalizeRelayList(input.relays);
        var label = String(input.label || walletAddress || publicKeyHex.slice(0, 12)).trim();
        var contact = {
            id: walletAddress || publicKeyHex,
            label: label.slice(0, 80),
            publicKeyHex: publicKeyHex,
            relays: relays,
            updatedAt: new Date().toISOString()
        };
        if (walletAddress) { contact.walletAddress = walletAddress; }
        return contact;
    };

    Contacts.toRecipient = function (contact) {
        var normalized = normalizeContact(contact);
        var recipient = {
            publicKeyHex: normalized.publicKeyHex,
            relays: normalized.relays
        };
        if (normalized.walletAddress) {
            recipient.walletAddress = normalized.walletAddress;
        }
        return recipient;
    };

    Contacts.getLabel = function (contact) {
        return contact.walletAddress || contact.label || contact.publicKeyHex.slice(0, 12);
    };

    var matchesContact = function (contact, id) {
        var normalizedId = String(id || '').trim().toLowerCase();
        if (!normalizedId) { return false; }
        return [
            contact.id,
            contact.walletAddress,
            contact.publicKeyHex,
            contact.label
        ].filter(Boolean).some(function (value) {
            return String(value).trim().toLowerCase() === normalizedId;
        });
    };

    Contacts.list = function (common, cb) {
        common.getAttribute(ATTR_PATH, function (err, val) {
            if (err) { return void cb(err); }
            var contacts = Array.isArray(val) ? val : [];
            cb(void 0, contacts.map(function (contact) {
                try {
                    return normalizeContact(contact);
                } catch (e) {
                    return null;
                }
            }).filter(Boolean).sort(function (a, b) {
                return Contacts.getLabel(a).localeCompare(Contacts.getLabel(b));
            }));
        });
    };

    Contacts.upsert = function (common, input, cb) {
        cb = cb || function () {};
        var raw = input || {};
        var contact;
        try {
            contact = normalizeContact(raw);
        } catch (err) {
            return void cb(err);
        }
        Contacts.list(common, function (err, contacts) {
            if (err) { return void cb(err); }
            var found = false;
            contacts = contacts.map(function (existing) {
                if (existing.id !== contact.id && existing.publicKeyHex !== contact.publicKeyHex) {
                    return existing;
                }
                found = true;
                return normalizeContact({
                    walletAddress: raw.walletAddress ? contact.walletAddress : existing.walletAddress,
                    label: raw.label ? contact.label : existing.label,
                    publicKeyHex: contact.publicKeyHex,
                    relays: contact.relays.length ? contact.relays : existing.relays
                });
            });
            if (!found) { contacts.push(contact); }
            contacts.sort(function (a, b) {
                return Contacts.getLabel(a).localeCompare(Contacts.getLabel(b));
            });
            common.setAttribute(ATTR_PATH, contacts, function (setErr) {
                cb(setErr, contact);
            });
        });
    };

    Contacts.find = function (common, id, cb) {
        cb = cb || function () {};
        Contacts.list(common, function (err, contacts) {
            if (err) { return void cb(err); }
            cb(void 0, contacts.find(function (contact) {
                return matchesContact(contact, id);
            }) || null);
        });
    };

    Contacts.remove = function (common, id, cb) {
        cb = cb || function () {};
        Contacts.list(common, function (err, contacts) {
            if (err) { return void cb(err); }
            common.setAttribute(ATTR_PATH, contacts.filter(function (contact) {
                return !matchesContact(contact, id);
            }), cb);
        });
    };

    return Contacts;
});
