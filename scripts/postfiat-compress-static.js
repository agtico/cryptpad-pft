#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const Fs = require('node:fs');
const Fsp = require('node:fs/promises');
const Path = require('node:path');
const Zlib = require('node:zlib');
const { promisify } = require('node:util');

const gzip = promisify(Zlib.gzip);
const brotliCompress = promisify(Zlib.brotliCompress);

const root = Path.resolve(process.argv[2] || 'www');
const minBytes = Number.parseInt(process.env.POSTFIAT_COMPRESS_MIN_BYTES || '1024', 10);
const extensions = new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.mjs',
    '.svg',
    '.txt',
    '.wasm',
    '.xml',
]);

const shouldCompress = (file, stat) => {
    if (!stat.isFile()) { return false; }
    if (file.endsWith('.gz') || file.endsWith('.br') || file.endsWith('.zst')) { return false; }
    if (stat.size < minBytes) { return false; }
    return extensions.has(Path.extname(file).toLowerCase());
};

const isCurrent = async (source, target, sourceStat) => {
    try {
        const targetStat = await Fsp.stat(target);
        return targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0;
    } catch {
        return false;
    }
};

async function* walk(dir) {
    const entries = await Fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = Path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(full);
        } else {
            yield full;
        }
    }
}

const writeCompressed = async (source, sourceStat) => {
    const input = await Fsp.readFile(source);
    const targets = [
        {
            path: `${source}.gz`,
            data: () => gzip(input, { level: 9 }),
        },
        {
            path: `${source}.br`,
            data: () => brotliCompress(input, {
                params: {
                    [Zlib.constants.BROTLI_PARAM_QUALITY]: 6,
                },
            }),
        },
    ];

    let written = 0;
    for (const target of targets) {
        if (await isCurrent(source, target.path, sourceStat)) { continue; }
        await Fsp.writeFile(target.path, await target.data());
        written++;
    }
    return written;
};

(async () => {
    if (!Fs.existsSync(root)) {
        throw new Error(`Static root does not exist: ${root}`);
    }

    let files = 0;
    let writes = 0;
    let sourceBytes = 0;

    for await (const file of walk(root)) {
        const stat = await Fsp.stat(file);
        if (!shouldCompress(file, stat)) { continue; }
        files++;
        sourceBytes += stat.size;
        writes += await writeCompressed(file, stat);
    }

    console.log(JSON.stringify({
        root,
        files,
        writes,
        sourceBytes,
    }));
})().catch((err) => {
    console.error(err && err.stack || err);
    process.exit(1);
});
