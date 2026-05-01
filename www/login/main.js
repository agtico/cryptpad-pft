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
        const hash = window.location.hash;
        const forceStandardLogin = hash === "#standard-login";
        const forceLegacyLogin = forceStandardLogin || hash === "#legacy-login";
        const explicitWalletVault = hash === "#wallet-vault" || hash === "#unlock-wallet";
        const alreadyLoggedIn = LocalStore.isLoggedIn();
        const switchWalletLogin = alreadyLoggedIn && !explicitWalletVault && !forceLegacyLogin;
        const forceWalletVault = explicitWalletVault;
        const redirectLoggedInWhenWalletUnlocked = false;

        const postFiat = Config.postFiat || {};
        const walletFirst = postFiat.walletFirst !== false;
        const legacyDisabled = postFiat.disableLegacyLogin === true;
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

        var $legacyLogin = $('#pft-legacy-login');
        var $showLegacyLogin = $('#pft-show-legacy-login');
        var $uname = $('#name');

        var $passwd = $('#password')
        // background loading of login assets
        // enter key while on password field clicks signup
        .on('keydown', function (e) {
            if (legacyDisabled) { return; }
            if (e.which !== 13) { return; } // enter
            $('button.login').click();
        });
        $showLegacyLogin.click(function () {
            $legacyLogin.removeClass('cp-hidden');
            $showLegacyLogin.parent().addClass('cp-hidden');
            $uname.focus();
        });

        //var test;
        $('button.login').click(function () {
            if (legacyDisabled) { return; }
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
        var $saveWalletRow = $('#pft-save-wallet-row');
        var $savedWallet = $('#pft-saved-wallet');
        var $savedWalletAddress = $('#pft-saved-wallet-address');
        var $sessionWallet = $('#pft-session-wallet');
        var $sessionWalletStatus = $('#pft-session-wallet-status');
        var $seedLogin = $('#pft-seed-login');
        var $seedActions = $('#pft-seed-actions');
        var $generatedWallet = $('#pft-generated-wallet');
        var $generatedMnemonic = $('#pft-generated-mnemonic');
        var $generatedAddress = $('#pft-generated-wallet-address');
        var $generatedConfirm = $('#pft-generated-confirm');
        if (forceWalletVault) {
            $('.cp-page-title h1').text('Unlock Post Fiat wallet');
            $('.pft-login-subtitle p').text(
                'Unlock the wallet signer used for sharing and inbox access.'
            );
            $('.cp-login-instance').first().text('Wallet unlock');
            $('#pft-wallet-login').text(alreadyLoggedIn ?
                'Save and unlock wallet' : 'Save wallet on this browser');
            $('#pft-create-wallet').addClass('cp-hidden');
            $('#pft-show-legacy-login').parent().addClass('cp-hidden');
            $('#pft-legacy-login').addClass('cp-hidden');
            $checkImport.closest('.checkbox-container').addClass('cp-hidden');
            $saveWallet.prop('checked', true).prop('disabled', true);
        } else if (switchWalletLogin) {
            $('.cp-page-title h1').text('Switch Post Fiat wallet');
            $('.pft-login-subtitle p').text(
                'Log in with a different Post Fiat wallet for this tab.'
            );
            $checkImport.closest('.checkbox-container').addClass('cp-hidden');
            $saveWallet.prop('checked', false).prop('disabled', false);
        }
        var getWalletCore = function (quiet) {
            var Core = window.PostFiatWalletCore;
            if (!Core && !quiet) {
                UI.warn('Post Fiat wallet code is unavailable.');
                return;
            }
            return Core;
        };
        var redirectIfWalletSessionUnlocked = function () {
            if (!redirectLoggedInWhenWalletUnlocked) { return Promise.resolve(false); }
            var Core = getWalletCore(true);
            if (!Core || typeof(Core.restoreSessionWallet) !== 'function') {
                return Promise.resolve(false);
            }
            return Promise.resolve(Core.restoreSessionWallet()).then(function (session) {
                if (session && session.mnemonic) {
                    document.location.href = '/app/';
                    return true;
                }
                if (typeof(Core.requestSessionWallet) !== 'function') {
                    return false;
                }
                return Core.requestSessionWallet({ timeoutMs: 800 }).then(function (imported) {
                    if (imported && imported.mnemonic) {
                        document.location.href = '/app/';
                        return true;
                    }
                    return false;
                });
            }).catch(function (err) {
                console.error(err);
                return false;
            });
        };
        var setSeedRecoveryVisible = function (visible) {
            if (visible) {
                $seedLogin.removeClass('cp-hidden');
                $saveWalletRow.removeClass('cp-hidden');
                $seedActions.removeClass('cp-hidden');
                return;
            }
            $seedLogin.addClass('cp-hidden');
            $saveWalletRow.addClass('cp-hidden');
            $seedActions.addClass('cp-hidden');
        };
        var refreshWalletSeedButton = function () {
            if (!forceWalletVault) { return; }
            $('#pft-wallet-login').text($saveWallet[0].checked ?
                'Save and unlock wallet' : 'Unlock once with seed');
        };
        var getExistingWalletSession = function (Core, timeoutMs) {
            if (!Core || typeof(Core.restoreSessionWallet) !== 'function') {
                return Promise.resolve(null);
            }
            return Promise.resolve(Core.restoreSessionWallet()).then(function (session) {
                if (session || typeof(Core.requestSessionWallet) !== 'function') {
                    return session;
                }
                return Core.requestSessionWallet({ timeoutMs: timeoutMs || 1500 });
            });
        };
        var assertWalletMatchesAccount = function (wallet) {
            var accountName = LocalStore.getAccountName && LocalStore.getAccountName();
            if (accountName && wallet && wallet.address && accountName !== wallet.address) {
                throw new Error('WALLET_ACCOUNT_MISMATCH');
            }
        };
        var refreshSavedWallet = function () {
            var Core = getWalletCore(true);
            if (!Core || !Core.getSavedWalletMeta) { return; }
            try {
                var meta = Core.getSavedWalletMeta();
                if (!meta) {
                    $savedWallet.addClass('cp-hidden');
                    $savedWalletAddress.text('');
                    if (forceWalletVault) {
                        $sessionWallet.removeClass('cp-hidden');
                        $sessionWalletStatus.text('No saved wallet found on this browser.');
                        $saveWallet.prop('checked', false).prop('disabled', false);
                        setSeedRecoveryVisible(false);
                        refreshWalletSeedButton();
                    }
                    return;
                }
                $savedWallet.removeClass('cp-hidden');
                $savedWalletAddress.text(meta.address);
                if (forceWalletVault) {
                    $sessionWallet.addClass('cp-hidden');
                    $saveWallet.prop('checked', true).prop('disabled', true);
                    setSeedRecoveryVisible(false);
                    refreshWalletSeedButton();
                }
            } catch (err) {
                console.error(err);
                $savedWallet.addClass('cp-hidden');
                if (forceWalletVault) {
                    $sessionWallet.removeClass('cp-hidden');
                    $sessionWalletStatus.text('Unable to read the saved wallet on this browser.');
                    $saveWallet.prop('checked', false).prop('disabled', false);
                    setSeedRecoveryVisible(false);
                    refreshWalletSeedButton();
                }
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
        var startWalletSession = function (Core, mnemonic) {
            if (!Core.createSessionWallet) { return Promise.resolve(); }
            return Promise.resolve(Core.createSessionWallet(mnemonic)).then(function () {
                if (Core.startSessionWalletResponder) {
                    Core.startSessionWalletResponder();
                }
            });
        };
        var continueWithExistingSession = async function (options) {
            options = options || {};
            var Core = getWalletCore(!options.warn);
            if (!Core) { return false; }
            var showSessionPanel = forceWalletVault && $savedWallet.hasClass('cp-hidden');
            if (showSessionPanel) {
                $sessionWallet.removeClass('cp-hidden');
                $sessionWalletStatus.text('Checking current wallet session...');
            }
            try {
                var session = await getExistingWalletSession(Core, options.timeoutMs || 2500);
                if (!session || !session.mnemonic) {
                    throw new Error('POSTFIAT_WALLET_SESSION_REQUIRED');
                }
                var wallet = session.wallet || Core.deriveWalletFromMnemonic(session.mnemonic);
                assertWalletMatchesAccount(wallet);
                await startWalletSession(Core, session.mnemonic);
                document.location.href = '/app/';
                return true;
            } catch (err) {
                console.error(err);
                if (showSessionPanel) {
                    $sessionWalletStatus.text('No unlocked wallet session is available.');
                }
                if (options.warn) {
                    if (err.message === 'WALLET_ACCOUNT_MISMATCH') {
                        UI.warn('The active wallet session does not match this account.');
                    } else {
                        UI.warn('No unlocked Post Fiat wallet session is available.');
                    }
                }
                return false;
            }
        };
        var redirectAfterWalletLogin = function (Core, mnemonic) {
            return function () {
                startWalletSession(Core, mnemonic).then(function () {
                    LocalStore.clearLoginToken();
                    Login.redirect();
                }).catch(function (err) {
                    console.error(err);
                    UI.removeLoadingScreen(function () {
                        UI.warn('Unable to unlock the Post Fiat wallet for this session.');
                    });
                });
                return true;
            };
        };
        var loginWithMnemonic = async function (Core, mnemonic, shouldImport) {
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
                onOTP: UI.getOTPScreen,
                cb: redirectAfterWalletLogin(Core, wallet.mnemonic)
            });
        };
        var saveMnemonicIfRequested = async function (Core, mnemonic) {
            if (!$saveWallet[0].checked) { return; }
            var savePassword = $savePassword.val();
            if (!savePassword) {
                throw new Error('MISSING_SAVE_PASSWORD');
            }
            await Core.saveWallet(savePassword, mnemonic);
            refreshSavedWallet();
        };
        var redirectAfterVaultSetup = function () {
            document.location.href = '/app/';
        };
        var saveWalletVaultOnly = async function (Core, mnemonic) {
            var wallet = Core.deriveWalletFromMnemonic(mnemonic);
            var savePassword = $savePassword.val();

            assertWalletMatchesAccount(wallet);
            if ($saveWallet[0].checked && !savePassword) {
                throw new Error('MISSING_SAVE_PASSWORD');
            }

            if ($saveWallet[0].checked) {
                await Core.saveWallet(savePassword, wallet.mnemonic);
            }
            await startWalletSession(Core, wallet.mnemonic);
            refreshSavedWallet();
            UI.log($saveWallet[0].checked ?
                'Post Fiat wallet saved on this browser.' : 'Post Fiat wallet unlocked.');
            redirectAfterVaultSetup();
        };
        var createWallet = function () {
            var Core = getWalletCore();
            if (!Core) { return; }

            try {
                var mnemonic = Core.createMnemonic();
                var wallet = Core.deriveWalletFromMnemonic(mnemonic);
                $generatedMnemonic.val(mnemonic);
                $generatedAddress.text(wallet.address);
                $generatedConfirm[0].checked = false;
                $generatedWallet.removeClass('cp-hidden');
                $generatedMnemonic.focus();
            } catch (err) {
                console.error(err);
                UI.warn('Unable to create a Post Fiat wallet.');
            }
        };
        var walletLogin = async function () {
            var Core = getWalletCore();
            if (!Core) { return; }

            var mnemonic = $walletMnemonic.val();
            try {
                if (forceWalletVault && alreadyLoggedIn) {
                    await saveWalletVaultOnly(Core, mnemonic);
                    return;
                }
                await saveMnemonicIfRequested(Core, mnemonic);
                $walletMnemonic.val('');
                await loginWithMnemonic(Core, mnemonic, $checkImport[0].checked);
            } catch (err) {
                console.error(err);
                if (err.message === 'WALLET_ACCOUNT_MISMATCH') {
                    return void UI.warn('This seed phrase does not match the logged-in wallet account.');
                }
                if (err.message === 'MISSING_SAVE_PASSWORD') {
                    return void UI.warn('Enter a wallet password before saving.');
                }
                UI.warn('Invalid Post Fiat seed phrase.');
            }
        };
        var generatedWalletLogin = async function () {
            var Core = getWalletCore();
            if (!Core) { return; }

            var mnemonic = $generatedMnemonic.val();
            if (!$generatedConfirm[0].checked) {
                return void UI.warn('Confirm that you saved the generated seed phrase.');
            }
            try {
                if (forceWalletVault && alreadyLoggedIn) {
                    await saveWalletVaultOnly(Core, mnemonic);
                    return;
                }
                await saveMnemonicIfRequested(Core, mnemonic);
                $generatedMnemonic.val('');
                $generatedAddress.text('');
                $generatedWallet.addClass('cp-hidden');
                await loginWithMnemonic(Core, mnemonic, $checkImport[0].checked);
            } catch (err) {
                console.error(err);
                if (err.message === 'WALLET_ACCOUNT_MISMATCH') {
                    return void UI.warn('This generated wallet does not match the logged-in wallet account.');
                }
                if (err.message === 'MISSING_SAVE_PASSWORD') {
                    return void UI.warn('Enter a wallet password before saving.');
                }
                UI.warn('Unable to use the generated Post Fiat wallet.');
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
                if (forceWalletVault && alreadyLoggedIn) {
                    assertWalletMatchesAccount(saved.wallet);
                    await startWalletSession(Core, saved.mnemonic);
                    UI.log('Post Fiat wallet unlocked.');
                    redirectAfterVaultSetup();
                    return;
                }
                await loginWithMnemonic(Core, saved.mnemonic, $checkImport[0].checked);
            } catch (err) {
                console.error(err);
                if (err.message === 'WALLET_ACCOUNT_MISMATCH') {
                    return void UI.warn('This saved wallet does not match the logged-in wallet account.');
                }
                UI.warn('Unable to unlock saved Post Fiat wallet.');
            }
        };
        refreshSavedWallet();
        refreshSavePassword();
        var focusDefault = function () {
            if (!legacyDisabled && (!walletFirst || forceLegacyLogin)) {
                $uname.focus();
            } else if (!$savedWallet.hasClass('cp-hidden')) {
                $walletPassword.focus();
            } else {
                $walletMnemonic.focus();
            }
        };
        var finishInitialWalletRouting = function () {
            if (forceWalletVault && alreadyLoggedIn) {
                continueWithExistingSession({ timeoutMs: 2000 }).then(function (redirecting) {
                    if (!redirecting) { focusDefault(); }
                });
                return;
            }
            redirectIfWalletSessionUnlocked().then(function (redirecting) {
                if (!redirecting) { focusDefault(); }
            });
        };
        finishInitialWalletRouting();
        $saveWallet.on('change', function () {
            refreshSavePassword();
            refreshWalletSeedButton();
        });
        $('#pft-create-wallet-button').click(createWallet);
        $('#pft-regenerate-wallet').click(createWallet);
        $('#pft-use-generated-wallet').click(generatedWalletLogin);
        $('#pft-wallet-login').click(walletLogin);
        $('#pft-unlock-wallet').click(savedWalletLogin);
        $('#pft-use-session-wallet').click(function () {
            continueWithExistingSession({ timeoutMs: 5000, warn: true });
        });
        $('#pft-recover-wallet').click(function () {
            $sessionWallet.addClass('cp-hidden');
            setSeedRecoveryVisible(true);
            refreshSavePassword();
            refreshWalletSeedButton();
            $walletMnemonic.focus();
        });
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
