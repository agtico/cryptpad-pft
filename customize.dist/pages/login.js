// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([
    '/common/hyperscript.js',
    '/common/common-interface.js',
    '/customize/messages.js',
    '/customize/pages.js',
    '/api/config',
], function (h, UI, Msg, Pages, Config) {
    return function () {
        document.title = Msg.login_login;

        const ssoLength = Config?.sso?.list?.length;
        const forceStandardLogin = window.location.hash === "#standard-login";
        var ssoEnabled = (ssoLength && !forceStandardLogin) ? '': '.cp-hidden';
        var ssoEnforced = (Config?.sso?.force && !forceStandardLogin) ? '.cp-hidden' : '';
        if (ssoLength === 1 && ssoEnforced) {
            // SSO enforced and only one provider:
            // skip login page
            return;
        }
        return [h('div#cp-main', [
            Pages.infopageTopbar(),
            h('div.container.cp-container', [
                h('div.row.cp-page-title', h('h1', Msg.login_login)),
                h('div.row', [
                    h('div.col-md-3'+ssoEnforced),
                    h('div#userForm.form-group.col-md-6'+ssoEnforced, [
                        h('div.cp-login-instance', Msg._getKey('login_instance', [ Pages.Instance.name ])),
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
                                    autofocus: true,
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
                        h('div.checkbox-container', [
                            UI.createCheckbox('import-recent', Msg.register_importRecent),
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
                        h('div.cp-postfiat-wallet-login', [
                            h('div.cp-login-instance', 'Post Fiat wallet'),
                            h('div#pft-saved-wallet.cp-hidden', [
                                h('div.big-container', [
                                    h('div.input-container', [
                                        h('label.cp-default-label', { for: 'pft-wallet-password' }, 'Wallet password'),
                                        h('input.form-control#pft-wallet-password', {
                                            type: 'password',
                                            name: 'pft-wallet-password',
                                            autocomplete: 'current-password',
                                        }),
                                    ]),
                                    h('div.input-container', [
                                        h('label.cp-default-label', 'Saved wallet'),
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
                            h('div.big-container', [
                                h('div.input-container', [
                                    h('label.cp-default-label', { for: 'pft-mnemonic' }, '24-word seed phrase'),
                                    h('textarea.form-control#pft-mnemonic', {
                                        name: 'pft-mnemonic',
                                        autocomplete: 'off',
                                        autocorrect: 'off',
                                        autocapitalize: 'off',
                                        spellcheck: false,
                                        rows: 3,
                                    }),
                                ]),
                                h('div.input-container', [
                                    h('label.cp-default-label', { for: 'pft-save-password' }, 'New wallet password'),
                                    h('input.form-control#pft-save-password', {
                                        type: 'password',
                                        name: 'pft-save-password',
                                        autocomplete: 'new-password',
                                    }),
                                ]),
                            ]),
                            h('div.checkbox-container', [
                                UI.createCheckbox('pft-save-wallet', 'Save encrypted wallet on this browser'),
                            ]),
                            h('div.extra', [
                                h('button#pft-wallet-login.btn.btn-primary', {
                                    type: 'button',
                                }, 'Log in with seed'),
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
