// SPDX-FileCopyrightText: 2026 Post Fiat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const test = require('node:test');
const assert = require('node:assert/strict');
const Fs = require('node:fs/promises');
const Os = require('node:os');
const Path = require('node:path');

const BlobStore = require('../../lib/storage/blob');

const SAFE_KEY = 'A'.repeat(44);
const blobId = function (char) {
    return char.repeat(48);
};
const encode = function (value) {
    return Buffer.from(value, 'utf8').toString('base64');
};
const callback = function (fn) {
    return new Promise((resolve) => {
        fn(function (err, result) {
            resolve([err, result]);
        });
    });
};
const waitForStat = async function (path) {
    var lastError;
    for (var i = 0; i < 20; i++) {
        try {
            return await Fs.stat(path);
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    throw lastError;
};

const createStore = async function (t) {
    const root = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'cryptpad-blob-test-'));
    const sessions = Object.create(null);
    const methods = await new Promise((resolve, reject) => {
        BlobStore.create({
            blobPath: Path.join(root, 'blob'),
            blobStagingPath: Path.join(root, 'blobstage'),
            archivePath: Path.join(root, 'archive'),
            getSession: function (safeKey) {
                sessions[safeKey] = sessions[safeKey] || {};
                return sessions[safeKey];
            },
        }, function (err, store) {
            if (err) { return void reject(err); }
            resolve(store);
        });
    });

    t.after(function () {
        return Fs.rm(root, { recursive: true, force: true });
    });

    return {
        root,
        sessions,
        store: methods,
    };
};

test('blob uploads reject chunks without an initialized pending upload', async (t) => {
    const { store } = await createStore(t);
    const [err] = await callback((cb) => {
        store.uploadWs(SAFE_KEY, encode('hello'), cb);
    });

    assert.equal(err, 'NOT_READY');
});

test('blob uploads enforce declared upload size before every chunk write', async (t) => {
    const { root, sessions, store } = await createStore(t);
    const id = blobId('a');

    sessions[SAFE_KEY] = {
        pendingUploadSize: 4,
        currentUploadSize: 0,
    };

    var result = await callback((cb) => {
        store.uploadCookie(SAFE_KEY, cb);
    });
    assert.ifError(result[0]);

    result = await callback((cb) => {
        store.upload(SAFE_KEY, encode('ab'), cb);
    });
    assert.ifError(result[0]);
    assert.equal(result[1], 2);

    result = await callback((cb) => {
        store.upload(SAFE_KEY, encode('cde'), cb);
    });
    assert.equal(result[0], 'E_OVER_LIMIT');

    result = await callback((cb) => {
        store.upload(SAFE_KEY, encode('cd'), cb);
    });
    assert.ifError(result[0]);
    assert.equal(result[1], 2);

    result = await callback((cb) => {
        store.complete(SAFE_KEY, id, cb);
    });
    assert.ifError(result[0]);
    assert.equal(result[1], id);

    const finalPath = Path.join(root, 'blob', id.slice(0, 2), id);
    const stats = await waitForStat(finalPath);
    assert.equal(stats.size, 4);
});

test('blob completion rejects staged files whose size differs from the declared upload size', async (t) => {
    const { root, sessions, store } = await createStore(t);
    const id = blobId('b');
    const stagePath = Path.join(root, 'blobstage', SAFE_KEY.slice(0, 2), SAFE_KEY);

    sessions[SAFE_KEY] = {
        pendingUploadSize: 2,
        currentUploadSize: 2,
    };
    await Fs.mkdir(Path.dirname(stagePath), { recursive: true });
    await Fs.writeFile(stagePath, 'abc');

    const [err] = await callback((cb) => {
        store.complete(SAFE_KEY, id, cb);
    });

    assert.equal(err, 'E_SIZE_MISMATCH');
});
