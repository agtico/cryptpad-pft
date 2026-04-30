// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

(function (window) {
const factory = function (Nacl) {
    var Auth = {};

    Auth.requiredEntropyBytes = 192;
    Auth.loginMessageTemplate = 'I am willing to sign up as <ADDRESS> on a postfiat.org domain to use Post Fiat Services. DO NOT SIGN THIS MESSAGE ON ANY OTHER DOMAINS!';
    Auth.v3AccessMessageTemplate = 'PostFiat Access: <ADDRESS>';

    var getNacl = function () {
        if (!Nacl || typeof(Nacl.hash) !== 'function') {
            throw new Error('NACL_HASH_UNAVAILABLE');
        }
        return Nacl;
    };

    var encodeUTF8 = function (str) {
        if (typeof(TextEncoder) !== 'undefined') {
            return new TextEncoder().encode(str);
        }

        var encoded = unescape(encodeURIComponent(str));
        var out = new Uint8Array(encoded.length);
        for (var i = 0; i < encoded.length; i++) {
            out[i] = encoded.charCodeAt(i);
        }
        return out;
    };

    Auth.getLoginMessage = function (address) {
        return Auth.loginMessageTemplate.replace('<ADDRESS>', address);
    };

    Auth.getV3AccessMessage = function (address) {
        return Auth.v3AccessMessageTemplate.replace('<ADDRESS>', address);
    };

    Auth.hexToUint8Array = function (hex) {
        var clean = String(hex || '').trim().replace(/^0x/i, '');
        if (!clean || clean.length % 2 || /[^a-f0-9]/i.test(clean)) {
            throw new Error('INVALID_HEX_SIGNATURE');
        }

        var bytes = new Uint8Array(clean.length / 2);
        for (var i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    };

    Auth.normalizeSignature = function (signature) {
        if (signature instanceof Uint8Array) { return signature; }
        if (Array.isArray(signature)) { return new Uint8Array(signature); }
        return Auth.hexToUint8Array(signature);
    };

    Auth.uint8ArrayJoin = function (arrays) {
        var length = 0;
        arrays.forEach(function (array) {
            length += array.length;
        });

        var joined = new Uint8Array(length);
        var offset = 0;
        arrays.forEach(function (array) {
            joined.set(array, offset);
            offset += array.length;
        });
        return joined;
    };

    Auth.deriveCryptPadEntropy = function (signature, bytes) {
        var nacl = getNacl();
        var required = bytes || Auth.requiredEntropyBytes;
        var derived = new Uint8Array(0);
        var currentInput = Auth.normalizeSignature(signature);
        var counter = 0;

        while (derived.length < required) {
            var counterBytes = encodeUTF8(String(counter));
            var input = Auth.uint8ArrayJoin([currentInput, counterBytes]);
            var hash = nacl.hash(input);
            derived = Auth.uint8ArrayJoin([derived, hash]);
            currentInput = hash;
            counter++;
        }

        return derived.slice(0, required);
    };

    Auth.deriveWalletChannelBytes = function (encryptionSeed) {
        var nacl = getNacl();
        var hash = nacl.hash(new Uint8Array(encryptionSeed));
        return hash.subarray(32, 48);
    };

    return Auth;
};

    if (typeof(module) !== 'undefined' && module.exports) {
        module.exports = factory(require('tweetnacl/nacl-fast'));
    } else if ((typeof(define) !== 'undefined' && define !== null) && (define.amd !== null)) {
        define(['/components/tweetnacl/nacl-fast.min.js'], function () {
            return factory(globalThis.nacl);
        });
    } else {
        window.PostFiatWalletAuth = factory(window.nacl);
    }
}(typeof(self) !== 'undefined'? self: this));
