// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

export default {
    input: './src/postfiat/wallet-core.mjs',
    output: {
        name: 'PostFiatWalletCore',
        file: './www/common/postfiat-wallet-core.bundle.js',
        format: 'iife',
        plugins: [terser({
            format: { comments: false, ecma: '2015' }
        })],
    },
    plugins: [
        json(),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
    ],
};
