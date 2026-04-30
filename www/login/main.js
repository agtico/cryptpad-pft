// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([
    '/api/config',
    'jquery',
    '/common/hyperscript.js',
    '/common/cryptpad-common.js',
    '/customize/login.js',
    '/common/common-interface.js',
    '/common/common-realtime.js',
    '/common/common-feedback.js',
    '/common/outer/local-store.js',
    '/customize/messages.js',
    '/common/postfiat-wallet-auth.js',
    '/common/postfiat-wallet-core.bundle.js',
    //'/common/test.js',

], function (Config, $, h, Cryptpad, Login, UI, Realtime, Feedback, LocalStore, Messages, WalletAuth /*, WalletCore, Test */) {
    if (window.top !== window) { return; }
    $(function () {
        var $checkImport = $('#import-recent');
        if (LocalStore.isLoggedIn()) {
            // already logged in, redirect to drive
            document.location.href = '/drive/';
            return;
        }
        LocalStore.requestWalletSession(function (imported) {
            if (imported) {
                document.location.href = '/drive/';
            }
        });

        const forceStandardLogin = window.location.hash === "#standard-login";
        if (Config.sso) {
            // Config.sso.force => no legacy login allowed
            // Config.sso.password => cp password required or forbidden
            // Config.sso.list => list of configured identity providers
            var $sso = $('div.cp-login-sso');
            // Auto-redirect if only forceRedirect set to true
            const ssoLength = Config?.sso?.list?.length;
            const ssoEnforced = (Config?.sso?.force && !forceStandardLogin) ? '.cp-hidden' : '';
            if (ssoLength === 1 && ssoEnforced) {
                Login.ssoAuth(Config.sso.list[0], (err, data) => {
                    if (data && data.url) {
                        window.location.href = data.url;
                    } else {
                        console.error("SSO auto-redirect failed:", err || "no URL");
                        UI.warn(Messages.error);
                    }
                });
                return;
            }
            var list = Config.sso.list.map(function (name) {
                var b = h('button.btn.btn-secondary', name);
                var $b = $(b).click(function () {
                    $b.prop('disabled', 'disabled');
                    Login.ssoAuth(name, function (err, data) {
                        if (data.url) {
                            window.location.href = data.url;
                        }
                    });
                });
                return b;
            });
            $sso.append(list);

            // Disable bfcache (back/forward cache) to prevent SSO button
            // being disabled when using the browser "back" feature on the SSO page
            $(window).on('unload', () => {});
        }

        /* Log in UI */
        // deferred execution to avoid unnecessary asset loading
        var loginReady = function (cb) {
            if (Login) {
                if (typeof(cb) === 'function') { cb(); }
                return;
            }
            require([
            ], function (_Login) {
                Login = Login || _Login;
                if (typeof(cb) === 'function') { cb(); }
            });
        };
        loginReady();

        var $uname = $('#name').focus();

        var $passwd = $('#password')
        // background loading of login assets
        // enter key while on password field clicks signup
        .on('keydown', function (e) {
            if (e.which !== 13) { return; } // enter
            $('button.login').click();
        });

        //var test;
        $('button.login').click(function () {
            var shouldImport = $checkImport[0].checked;
            var uname = $uname.val();
            var passwd = $passwd.val();
            Login.loginOrRegisterUI({
                uname,
                passwd,
                shouldImport,
                onOTP: UI.getOTPScreen
            });
        });

        var $walletMnemonic = $('#pft-mnemonic');
        var $walletPassword = $('#pft-wallet-password');
        var $savePassword = $('#pft-save-password');
        var $savePasswordContainer = $('#pft-save-password-container');
        var $saveWallet = $('#pft-save-wallet');
        var $savedWallet = $('#pft-saved-wallet');
        var $savedWalletAddress = $('#pft-saved-wallet-address');
        var getWalletCore = function (quiet) {
            var Core = window.PostFiatWalletCore;
            if (!Core && !quiet) {
                UI.warn('Post Fiat wallet code is unavailable.');
                return;
            }
            return Core;
        };
        var refreshSavedWallet = function () {
            var Core = getWalletCore(true);
            if (!Core || !Core.getSavedWalletMeta) { return; }
            try {
                var meta = Core.getSavedWalletMeta();
                if (!meta) {
                    $savedWallet.addClass('cp-hidden');
                    $savedWalletAddress.text('');
                    return;
                }
                $savedWallet.removeClass('cp-hidden');
                $savedWalletAddress.text(meta.address);
            } catch (err) {
                console.error(err);
                $savedWallet.addClass('cp-hidden');
            }
        };
        var refreshSavePassword = function () {
            if ($saveWallet[0].checked) {
                $savePasswordContainer.removeClass('cp-hidden');
            } else {
                $savePasswordContainer.addClass('cp-hidden');
                $savePassword.val('');
            }
        };
        var loginWithMnemonic = function (Core, mnemonic, shouldImport) {
            var wallet = Core.deriveWalletFromMnemonic(mnemonic);
            var message = WalletAuth.getLoginMessage(wallet.address);
            var signed = Core.signMessage(mnemonic, message);

            Login.loginOrRegisterUI({
                uname: wallet.address,
                passwd: '',
                shouldImport: shouldImport,
                walletAuth: {
                    address: wallet.address,
                    publicKey: signed.publicKey,
                    signature: signed.signature,
                    message: message,
                },
                onOTP: UI.getOTPScreen
            });
        };
        var walletLogin = async function () {
            var Core = getWalletCore();
            if (!Core) { return; }

            var mnemonic = $walletMnemonic.val();
            try {
                if ($saveWallet[0].checked) {
                    var savePassword = $savePassword.val();
                    if (!savePassword) {
                        return void UI.warn('Enter a wallet password before saving.');
                    }
                    await Core.saveWallet(savePassword, mnemonic);
                    refreshSavedWallet();
                }
                $walletMnemonic.val('');
                loginWithMnemonic(Core, mnemonic, $checkImport[0].checked);
            } catch (err) {
                console.error(err);
                UI.warn('Invalid Post Fiat seed phrase.');
            }
        };
        var savedWalletLogin = async function () {
            var Core = getWalletCore();
            if (!Core) { return; }

            try {
                var password = $walletPassword.val();
                if (!password) {
                    return void UI.warn('Enter your wallet password.');
                }
                var saved = await Core.unlockSavedWallet(password);
                loginWithMnemonic(Core, saved.mnemonic, $checkImport[0].checked);
            } catch (err) {
                console.error(err);
                UI.warn('Unable to unlock saved Post Fiat wallet.');
            }
        };
        refreshSavedWallet();
        refreshSavePassword();
        $saveWallet.on('change', refreshSavePassword);
        $('#pft-wallet-login').click(walletLogin);
        $('#pft-unlock-wallet').click(savedWalletLogin);
        $('#pft-forget-wallet').click(function () {
            var Core = getWalletCore();
            if (!Core) { return; }
            Core.clearSavedWallet();
            $walletPassword.val('');
            refreshSavedWallet();
        });
        $walletPassword.on('keydown', function (e) {
            if (e.which !== 13) { return; }
            savedWalletLogin();
        });
        $walletMnemonic.on('keydown', function (e) {
            if (e.which !== 13 || !(e.ctrlKey || e.metaKey)) { return; }
            walletLogin();
        });
        $('#register').on('click', function () {
            if ($uname.val()) {
                localStorage.login_user = $uname.val();
            }
            var hash = (window.location.hash || '').replace(/\/login\//, '/register/');
            window.location.href = '/register/' + hash;
        });

/*
        Test(function (t) {
            $uname.val('testuser');
            $passwd.val('testtest');
            test = t;
            $('button.login').click();
        });
        */
    });
});
