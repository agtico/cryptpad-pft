// SPDX-FileCopyrightText: 2026 Post Fiat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const test = require('node:test');
const assert = require('node:assert/strict');

const HttpCommands = require('../../lib/http-commands');

const makeResponse = function () {
    return {
        statusCode: 0,
        body: undefined,
        status: function (code) {
            this.statusCode = code;
            return this;
        },
        json: function (body) {
            this.body = body;
            return this;
        },
    };
};

test('challenge response debugging logs redact secrets and signatures', () => {
    const logs = [];
    const res = makeResponse();
    const sig = 's'.repeat(88);
    const txid = 't'.repeat(32);

    HttpCommands.handle({
        Log: {
            error: function (tag, payload) {
                logs.push({ tag, payload });
            },
        },
    }, {
        body: {
            txid,
            sig,
            code: '123456',
            secret: 'totp-secret',
            nested: {
                recoveryKey: 'recovery-secret',
            },
        },
    }, res);

    assert.equal(res.statusCode, 500);
    assert.equal(logs[0].tag, 'CHALLENGE_RESPONSE_DEBUGGING');
    assert.equal(logs[0].payload.sig, '[REDACTED]');
    assert.equal(logs[0].payload.code, '[REDACTED]');
    assert.equal(logs[0].payload.secret, '[REDACTED]');
    assert.equal(logs[0].payload.nested.recoveryKey, '[REDACTED]');
});
