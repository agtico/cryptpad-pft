// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([
    '/common/hyperscript.js',
    '/common/common-interface.js',
    '/customize/messages.js',
    '/customize/pages.js',
    '/api/config',
    '/common/outer/local-store.js',
], function (h, UI, Msg, Pages, Config, LocalStore) {
    return function () {
        document.title = Msg.login_login;

        const ssoLength = Config?.sso?.list?.length;
        const hash = window.location.hash;
        const forceStandardLogin = hash === "#standard-login";
        const forceLegacyLogin = forceStandardLogin || hash === "#legacy-login";
        const explicitWalletVault = hash === "#wallet-vault" || hash === "#unlock-wallet";
        const alreadyLoggedIn = LocalStore.isLoggedIn();
        const forceWalletVault = explicitWalletVault || (alreadyLoggedIn && !forceLegacyLogin);
        const postFiat = Config.postFiat || {};
        const walletFirst = postFiat.walletFirst !== false;
        const legacyDisabled = postFiat.disableLegacyLogin === true;
        var legacyHidden = (forceWalletVault || legacyDisabled ||
            (walletFirst && !forceLegacyLogin)) ? '.cp-hidden' : '';
        var legacyToggleHidden = (forceWalletVault || !walletFirst ||
            legacyDisabled || forceLegacyLogin) ? '.cp-hidden' : '';
        var importRecentHidden = forceWalletVault ? '.cp-hidden' : '';
        var ssoEnabled = (ssoLength && !forceStandardLogin) ? '': '.cp-hidden';
        var ssoEnforced = (Config?.sso?.force && !forceStandardLogin) ? '.cp-hidden' : '';
        if (ssoLength === 1 && ssoEnforced) {
            // SSO enforced and only one provider:
            // skip login page
            return;
        }
        var pftLoginCss = [
            '#cp-main.pft-login-page{min-height:100vh;background:#f5f7f8;color:#17201c;}',
            '#cp-main.pft-login-page .navbar,#cp-main.pft-login-page .cp-topbar,#cp-main.pft-login-page footer,#cp-main.pft-login-page .cp-footer{display:none!important;}',
            '#cp-main.pft-login-page .cp-container{max-width:760px;min-height:100vh;display:grid;align-content:center;padding:32px 16px;}',
            '#cp-main.pft-login-page .cp-page-title h1{margin:0;color:#17201c;font-family:Arial,sans-serif;font-size:36px;font-weight:800;letter-spacing:0;text-align:center;}',
            '#cp-main.pft-login-page .pft-login-subtitle p{width:100%;margin:8px 0 18px;color:#5e6b64;text-align:center;}',
            '#cp-main.pft-login-page #userForm{float:none;max-width:620px;margin:0 auto;padding:20px;border:1px solid #dbe3e4;border-radius:8px;background:#fff;box-shadow:0 18px 48px rgba(20,31,28,.12);}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login .cp-login-instance{margin-bottom:14px;color:#17201c;font-size:18px;font-weight:800;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login .big-container{display:grid!important;grid-template-columns:1fr!important;gap:10px;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login .input-container{display:block!important;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login .cp-default-label{display:block!important;margin-bottom:6px;color:#415049;font-size:12px;font-weight:700;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login textarea.form-control,#cp-main.pft-login-page .cp-postfiat-wallet-login input.form-control,#cp-main.pft-login-page #pft-saved-wallet-address,#cp-main.pft-login-page #pft-generated-wallet-address{border:1px solid #ccd7da;border-radius:8px;background:#fff;box-shadow:none;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login textarea.form-control,#cp-main.pft-login-page .cp-postfiat-wallet-login input.form-control{width:100%!important;max-width:none!important;}',
            '#cp-main.pft-login-page .cp-postfiat-wallet-login .extra{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;}',
            '#cp-main.pft-login-page .btn{border-radius:8px;font-weight:700;text-transform:none;}',
            '#cp-main.pft-login-page .btn-primary{border-color:#1c6f5a;background:#1c6f5a;}',
            '#cp-main.pft-login-page .cp-login-encryption{display:none;}'
        ].join('');
        return [h('div#cp-main.pft-login-page', [
            h('style', pftLoginCss),
            Pages.infopageTopbar(),
            h('div.container.cp-container', [
                h('div.row.cp-page-title', h('h1', forceWalletVault ?
                    'Unlock Post Fiat wallet' : 'Post Fiat Docs')),
                h('div.row.cp-page-title.pft-login-subtitle', h('p', forceWalletVault ?
                    'Unlock the wallet signer used for sharing and inbox access.' :
                    'Open a private document workspace with your Post Fiat wallet.')),
                h('div.row', [
                    h('div.col-md-3'+ssoEnforced),
                    h('div#userForm.form-group.col-md-6'+ssoEnforced, [
                        h('div.cp-postfiat-wallet-login', [
                            h('div.cp-login-instance', forceWalletVault ?
                                'Wallet unlock' : 'Post Fiat wallet'),
                            h('div#pft-saved-wallet.cp-hidden', [
                                h('div.big-container', [
                                    h('div.input-container', [
                                        h('label.cp-default-label', { for: 'pft-wallet-password' }, 'Wallet unlock password'),
                                        h('input.form-control#pft-wallet-password', {
                                            type: 'password',
                                            name: 'pft-wallet-password',
                                            autocomplete: 'current-password',
                                            placeholder: 'Wallet unlock password',
                                        }),
                                    ]),
                                    h('div.input-container', [
                                        h('label.cp-default-label', 'Saved wallet address'),
                                        h('div#pft-saved-wallet-address.form-control', {
                                            tabindex: 0,
                                        }),
                                    ]),
                                ]),
                                h('div.extra', [
                                    h('button#pft-unlock-wallet.btn.btn-primary', {
                                        type: 'button',
                                    }, 'Unlock wallet'),
                                    h('button#pft-forget-wallet.btn.btn-secondary', {
                                        type: 'button',
                                    }, 'Forget'),
                                ]),
                            ]),
                            h('div#pft-create-wallet', [
                                h('div.extra', [
                                    h('button#pft-create-wallet-button.btn.btn-secondary', {
                                        type: 'button',
                                    }, 'Create new wallet'),
                                ]),
                                h('div#pft-generated-wallet.cp-hidden', [
                                    h('div.big-container', [
                                        h('div.input-container', [
                                            h('label.cp-default-label', { for: 'pft-generated-mnemonic' }, 'Generated 24-word seed phrase'),
                                            h('textarea.form-control#pft-generated-mnemonic', {
                                                name: 'pft-generated-mnemonic',
                                                autocomplete: 'off',
                                                autocorrect: 'off',
                                                autocapitalize: 'off',
                                                spellcheck: false,
                                                readonly: true,
                                                rows: 3,
                                            }),
                                        ]),
                                        h('div.input-container', [
                                            h('label.cp-default-label', 'Generated wallet address'),
                                            h('div#pft-generated-wallet-address.form-control', {
                                                tabindex: 0,
                                            }),
                                        ]),
                                    ]),
                                    h('div.checkbox-container', [
                                        UI.createCheckbox('pft-generated-confirm', 'I saved this seed phrase'),
                                    ]),
                                    h('div.extra', [
                                        h('button#pft-use-generated-wallet.btn.btn-primary', {
                                            type: 'button',
                                        }, 'Use generated wallet'),
                                        h('button#pft-regenerate-wallet.btn.btn-secondary', {
                                            type: 'button',
                                        }, 'Regenerate'),
                                    ]),
                                ]),
                            ]),
                            h('div#pft-seed-login.big-container', [
                                h('div.input-container', [
                                    h('label.cp-default-label', { for: 'pft-mnemonic' }, forceWalletVault ?
                                        'Recover wallet with 24-word seed phrase' : '24-word seed phrase'),
                                    h('textarea.form-control#pft-mnemonic', {
                                        name: 'pft-mnemonic',
                                        autocomplete: 'off',
                                        autocorrect: 'off',
                                        autocapitalize: 'off',
                                        spellcheck: false,
                                        rows: 3,
                                    }),
                                ]),
                                h('div#pft-save-password-container.input-container.cp-hidden', [
                                    h('label.cp-default-label', { for: 'pft-save-password' }, 'Create wallet unlock password'),
                                    h('input.form-control#pft-save-password', {
                                        type: 'password',
                                        name: 'pft-save-password',
                                        autocomplete: 'new-password',
                                        placeholder: 'Create wallet unlock password',
                                    }),
                                ]),
                            ]),
                            h('div#pft-save-wallet-row.checkbox-container', [
                                UI.createCheckbox('pft-save-wallet', 'Save encrypted wallet on this browser', true),
                            ]),
                            h('div#pft-seed-actions.extra', [
                                h('button#pft-wallet-login.btn.btn-primary', {
                                    type: 'button',
                                }, 'Log in with seed'),
                            ]),
                        ]),
                        h('div.checkbox-container' + importRecentHidden, [
                            UI.createCheckbox('import-recent', Msg.register_importRecent),
                        ]),
                        h('div.extra'+legacyToggleHidden, [
                            h('button#pft-show-legacy-login.btn.btn-secondary', {
                                type: 'button',
                            }, 'Legacy CryptPad login'),
                        ]),
                        h('div#pft-legacy-login.cp-legacy-login'+legacyHidden, [
                            h('div.cp-login-instance', 'Legacy CryptPad login'),
                            h('div.big-container', [
                                h('div.input-container', [
                                    h('label.cp-default-label', { for: 'name' }, Msg.login_username),
                                    h('input.form-control#name', {
                                        name: 'name',
                                        type: 'text',
                                        autocomplete: 'off',
                                        autocorrect: 'off',
                                        autocapitalize: 'off',
                                        spellcheck: false,
                                        placeholder: Msg.login_username,
                                    }),
                                ]),
                                h('div.input-container', [
                                    h('label.cp-default-label', { for: 'password' }, Msg.login_password),
                                    h('input.form-control#password', {
                                        type: 'password',
                                        'name': 'password',
                                        placeholder: Msg.login_password,
                                        autocomplete: "current-password"
                                    }),
                                ]),
                            ]),
                            h('div.extra', [
                                (Config.restrictRegistration?
                                    h('div'):
                                    h('a#register', {
                                        href: "/register/",
                                    }, Msg.login_register)
                                ),
                                h('button.login', Msg.login_login),
                            ]),
                        ]),
                    ]),
                    h('div.col-md-3'+ssoEnforced),
                    h('div.col-md-3'+ssoEnabled),
                    h('div#ssoForm.form-group.col-md-6'+ssoEnabled, [
                        h('div.cp-login-sso', Msg.sso_login_description)
                    ]),
                    h('div.col-md-3'+ssoEnabled),
                ]),
                h('div.row.cp-login-encryption', [
                    h('div.col-md-3'),
                    h('div.col-md-6', Msg.register_warning_note),
                    h('div.col-md-3'),
                ]),
            ]),
            Pages.infopageFooter(),
        ])];
    };
});
