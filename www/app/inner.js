// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable no-use-before-define */

define([
    'jquery',
    '/api/config',
    '/common/hyperscript.js',
    '/common/common-util.js',
    '/common/common-hash.js',
    '/common/common-interface.js',
    '/components/nthen/index.js',
    '/common/sframe-common.js',
    '/customize/messages.js',
    '/common/clipboard.js',
    '/common/postfiat-private-share-contacts.js',
    '/common/common-icons.js',
    '/common/postfiat-wallet-core.bundle.js',
    '/common/postfiat-private-share.bundle.js',

    'css!/components/bootstrap/dist/css/bootstrap.min.css',
    'less!/app/app-postfiat.less',
], function ($, ApiConfig, h, Util, Hash, UI, nThen, SFCommon, Messages, Clipboard,
             PostFiatContacts, Icons) {
    var APP = {
        route: (window.location.hash || '#docs').slice(1) || 'docs',
        docs: [],
        contacts: [],
        inbox: [],
        sent: [],
        wallet: null,
        walletSession: null,
        walletStatus: 'Checking',
        inboxDirectory: null,
        inboxDirectoryState: 'idle',
        inboxPublishedRelays: [],
        inboxPublishFailures: [],
        shareDoc: null,
        shareStatus: '',
        inboxStatus: '',
        settingsStatus: '',
        search: '',
        driveLoaded: false,
        inboxLoaded: false,
        inboxLoading: false,
    };

    var common;
    var sframeChan;
    var readySent;

    var routeLabels = {
        docs: 'Docs',
        shared: 'Shared with me',
        sent: 'Sent',
        contacts: 'Contacts',
        durable: 'Durable',
        settings: 'Settings',
    };

    var appTypes = [
        { type: 'pad', label: 'Document' },
        { type: 'sheet', label: 'Sheet' },
        { type: 'code', label: 'Code' },
        { type: 'kanban', label: 'Board' },
        { type: 'whiteboard', label: 'Whiteboard' },
    ];

    var isWalletAddress = function (value) {
        return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/u.test(String(value || '').trim());
    };

    var shortText = function (value) {
        var text = String(value || '');
        return text.length > 18 ? text.slice(0, 8) + '...' + text.slice(-6) : text;
    };

    var icon = function (name) {
        try {
            return Icons.get(name);
        } catch (err) {
            console.error(err);
            return h('span');
        }
    };

    var button = function (className, label, iconName, attrs) {
        attrs = attrs || {};
        attrs.type = attrs.type || 'button';
        attrs.class = className;
        var children = [];
        if (iconName) { children.push(icon(iconName)); }
        children.push(h('span', label));
        return h('button', attrs, children);
    };

    var setRoute = function (route) {
        APP.route = routeLabels[route] ? route : 'docs';
        window.location.hash = APP.route;
        render();
    };

    var getPostFiatRelays = function () {
        var nostr = (ApiConfig.postFiat && ApiConfig.postFiat.nostr) || {};
        var relays = Array.isArray(nostr.privateRelays) && nostr.privateRelays.length ?
            nostr.privateRelays : nostr.relays;
        return Array.isArray(relays) ? relays : [];
    };

    var parseRelayInput = function (value) {
        return String(value || '').split(/[\s,]+/u)
            .map(function (relay) { return relay.trim(); })
            .filter(Boolean);
    };

    var queryOuter = function (name, data, timeout) {
        return new Promise(function (resolve, reject) {
            sframeChan.query(name, data, function (err, obj) {
                if (err) { reject(new Error(err)); return; }
                resolve(obj);
            }, { timeout: timeout || 30000 });
        });
    };

    var getWalletCore = function () {
        var Core = window.PostFiatWalletCore;
        if (!Core) { throw new Error('POSTFIAT_WALLET_CORE_UNAVAILABLE'); }
        return Core;
    };

    var requestOuterWalletSession = function () {
        var Core = getWalletCore();
        return queryOuter('Q_POSTFIAT_WALLET_SESSION', null, 3000).then(function (obj) {
            if (!obj || !obj.state || !obj.mnemonic) { return null; }
            var wallet = Core.deriveWalletFromMnemonic(obj.mnemonic);
            if (obj.wallet && obj.wallet.address && obj.wallet.address !== wallet.address) {
                throw new Error('POSTFIAT_WALLET_SESSION_MISMATCH');
            }
            return Promise.resolve(Core.createSessionWallet(wallet.mnemonic)).then(function () {
                if (typeof(Core.startSessionWalletResponder) === 'function') {
                    Core.startSessionWalletResponder();
                }
                return {
                    mnemonic: wallet.mnemonic,
                    wallet: wallet
                };
            });
        }).catch(function (err) {
            console.error(err);
            return null;
        });
    };

    var getLoggedInWalletAccount = function () {
        var metadataMgr = common && common.getMetadataMgr && common.getMetadataMgr();
        var privateData = metadataMgr && metadataMgr.getPrivateData && metadataMgr.getPrivateData();
        var userData = metadataMgr && metadataMgr.getUserData && metadataMgr.getUserData();
        var accountName = privateData && privateData.accountName || userData && userData.name;

        return isWalletAddress(accountName) ? accountName : '';
    };

    var setUnlockedWalletSession = function (session) {
        var Core = getWalletCore();
        var accountName;

        if (!session || !session.mnemonic) {
            throw new Error('POSTFIAT_WALLET_SESSION_REQUIRED');
        }
        if (!session.wallet) {
            session.wallet = Core.deriveWalletFromMnemonic(session.mnemonic);
        }
        accountName = getLoggedInWalletAccount();
        if (accountName && session.wallet.address !== accountName) {
            if (Core && typeof(Core.clearSessionWallet) === 'function') {
                Promise.resolve(Core.clearSessionWallet()).catch(function (err) {
                    console.error(err);
                });
            }
            throw new Error('POSTFIAT_WALLET_ACCOUNT_MISMATCH');
        }
        APP.wallet = session.wallet;
        APP.walletSession = session;
        APP.walletStatus = 'Unlocked';
        return session;
    };

    var getSessionWallet = function () {
        var Core = getWalletCore();
        if (APP.walletSession && APP.walletSession.mnemonic) {
            return Promise.resolve(setUnlockedWalletSession(APP.walletSession));
        }
        return Promise.resolve().then(function () {
            return Core.restoreSessionWallet();
        }).catch(function (err) {
            console.error(err);
            return null;
        }).then(function (session) {
            if (session || typeof(Core.requestSessionWallet) !== 'function') { return session; }
            return Core.requestSessionWallet({ timeoutMs: 1200 });
        }).catch(function (err) {
            console.error(err);
            return null;
        }).then(function (session) {
            if (session) { return session; }
            return requestOuterWalletSession();
        }).then(function (session) {
            return setUnlockedWalletSession(session);
        });
    };

    var openTopLevel = function (href) {
        try {
            window.top.location.href = href;
            return;
        } catch (err) {
            console.error(err);
        }
        common.openURL(href);
    };

    var openWalletUnlock = function () {
        openTopLevel('/login/#unlock-wallet');
    };

    var clearWalletSession = function () {
        try {
            var Core = getWalletCore();
            if (typeof(Core.clearSessionWallet) === 'function') {
                return Promise.resolve(Core.clearSessionWallet());
            }
        } catch (err) {
            console.error(err);
        }
        return Promise.resolve();
    };

    var lockWalletSession = function () {
        clearWalletSession().catch(function (err) {
            console.error(err);
        }).then(function () {
            APP.wallet = null;
            APP.walletSession = null;
            clearInboxDirectoryState();
            APP.walletStatus = 'Locked';
            APP.settingsStatus = 'Wallet locked.';
            UI.log('Post Fiat wallet locked.');
            render();
        });
    };

    var isWalletSessionError = function (err) {
        return err && (
            err.message === 'POSTFIAT_WALLET_SESSION_REQUIRED' ||
            err.message === 'POSTFIAT_WALLET_ACCOUNT_MISMATCH'
        );
    };

    var isWalletAccountMismatch = function (err) {
        return err && err.message === 'POSTFIAT_WALLET_ACCOUNT_MISMATCH';
    };

    var handleWalletSessionRequired = function (message) {
        APP.wallet = null;
        APP.walletSession = null;
        clearInboxDirectoryState();
        APP.walletStatus = 'Locked';
        UI.warn(message || 'Unlock your Post Fiat wallet first.');
    };

    var getShareErrorMessage = function (err) {
        var code = err && err.message;
        if (code === 'POSTFIAT_RECIPIENT_DIRECTORY_NOT_FOUND') {
            return 'Recipient wallet has not published a sharing inbox yet.';
        }
        if (code === 'MISSING_NOSTR_RELAYS') {
            return 'Add at least one relay before sending.';
        }
        if (code === 'MISSING_POSTFIAT_RECIPIENT') {
            return 'Enter a recipient wallet address or inbox.';
        }
        if (code === 'INVALID_POSTFIAT_RECIPIENT') {
            return 'Recipient is not a valid wallet address or inbox.';
        }
        if (code === 'POSTFIAT_WALLET_ACCOUNT_MISMATCH') {
            return 'Unlocked wallet does not match this workspace account.';
        }
        return code || 'Unable to send share.';
    };

    var clearInboxDirectoryState = function () {
        APP.inboxDirectory = null;
        APP.inboxDirectoryState = 'idle';
        APP.inboxPublishedRelays = [];
        APP.inboxPublishFailures = [];
    };

    var getRelayFailureMessage = function (result) {
        return result.relayUrl + ': ' + (result.message || 'Connection failed');
    };

    var getUsableHref = function (value) {
        var href = String(value || '');
        if (href.indexOf('#') === -1) { return ''; }
        return href;
    };

    var getDocHref = function (doc, mode) {
        if (mode === 'view') {
            return getUsableHref(doc.roHref) || getUsableHref(doc.href);
        }
        return getUsableHref(doc.href) || getUsableHref(doc.roHref);
    };

    var getDocType = function (href) {
        try {
            return Hash.parsePadUrl(href).type || 'pad';
        } catch (err) {
            return 'pad';
        }
    };

    var collectRootIds = function (root, out) {
        out = out || {};
        if (!root || typeof(root) !== 'object') { return out; }
        Object.keys(root).forEach(function (key) {
            var value = root[key];
            if (typeof(value) === 'number' || typeof(value) === 'string') {
                out[String(value)] = true;
                return;
            }
            if (value && typeof(value) === 'object' && value.metadata !== true) {
                collectRootIds(value, out);
            }
        });
        return out;
    };

    var collectTrashIds = function (trash, out) {
        out = out || {};
        if (!trash || typeof(trash) !== 'object') { return out; }
        Object.keys(trash).forEach(function (key) {
            var list = trash[key];
            if (!Array.isArray(list)) { return; }
            list.forEach(function (entry) {
                var value = entry && entry.element;
                if (typeof(value) === 'number' || typeof(value) === 'string') {
                    out[String(value)] = true;
                    return;
                }
                collectRootIds(value, out);
            });
        });
        return out;
    };

    var normalizeDriveDocs = function (driveObject) {
        var drive = (driveObject && driveObject.drive) || {};
        var filesData = drive.filesData || {};
        var rootIds = collectRootIds(drive.root || {});
        var trashIds = collectTrashIds(drive.trash || {});
        var templateIds = {};
        (drive.template || []).forEach(function (id) {
            templateIds[String(id)] = true;
        });
        return Object.keys(filesData).map(function (id) {
            var data = filesData[id] || {};
            var href = getUsableHref(data.href);
            var roHref = getUsableHref(data.roHref);
            var bestHref = href || roHref;
            return {
                id: String(id),
                title: data.filename || data.title || 'Untitled document',
                href: href,
                roHref: roHref,
                type: getDocType(bestHref),
                atime: data.atime || data.ctime || 0,
                ctime: data.ctime || 0,
                tags: data.tags || [],
                root: Boolean(rootIds[String(id)]),
                trash: Boolean(trashIds[String(id)]),
                template: Boolean(templateIds[String(id)]),
                channel: data.channel,
            };
        }).filter(function (doc) {
            return getDocHref(doc, 'view');
        }).sort(function (a, b) {
            return (b.atime || b.ctime || 0) - (a.atime || a.ctime || 0);
        });
    };

    var loadDrive = function () {
        return queryOuter('Q_DRIVE_GETOBJECT', null).then(function (obj) {
            APP.docs = normalizeDriveDocs(obj);
            APP.driveLoaded = true;
        });
    };

    var loadContacts = function () {
        return new Promise(function (resolve) {
            PostFiatContacts.list(common, function (err, contacts) {
                if (err) {
                    console.error(err);
                    APP.contacts = [];
                    resolve();
                    return;
                }
                APP.contacts = contacts || [];
                resolve();
            });
        });
    };

    var openHref = function (href) {
        if (!href) { return; }
        if (href.charAt(0) === '/') {
            common.openURL(href);
            return;
        }
        common.openUnsafeURL(href);
    };

    var copyText = function (value, success) {
        Clipboard.copy(value, function (err) {
            if (err) {
                UI.warn(Messages.error);
                return;
            }
            UI.log(success || Messages.copied || 'Copied.');
        });
    };

    var parseRecipient = function (value, relays) {
        var text = String(value || '').trim();
        if (!text) { throw new Error('MISSING_POSTFIAT_RECIPIENT'); }
        var recipient = text[0] === '{' ? JSON.parse(text) :
            isWalletAddress(text) ? { walletAddress: text } : { publicKeyHex: text };
        if (!Array.isArray(recipient.relays) || !recipient.relays.length) {
            recipient.relays = relays;
        }
        return recipient;
    };

    var shareDocument = function () {
        var ShareWorkflow = window.PostFiatPrivateShare;
        if (!ShareWorkflow || typeof(ShareWorkflow.publishLivePadPrivateShare) !== 'function') {
            UI.warn('Post Fiat sharing is unavailable.');
            return;
        }
        var doc = APP.shareDoc;
        var mode = $('[name="pft-share-mode"]:checked').val() || 'edit';
        var relayList = parseRelayInput($('#pft-share-relays').val());
        var href = getDocHref(doc, mode);
        var recipientText = $('#pft-share-recipient').val();
        if (!href) {
            APP.shareStatus = 'No usable document link.';
            render();
            return;
        }
        APP.shareStatus = 'Sending...';
        render();
        getSessionWallet().then(function (session) {
            var recipient = parseRecipient(recipientText, relayList);
            return ShareWorkflow.publishLivePadPrivateShare({
                senderMnemonic: session.mnemonic,
                recipientDirectory: recipient,
                postFiatConfig: ApiConfig.postFiat,
                fallbackRelays: relayList,
                directoryRelays: relayList,
                origin: common.getMetadataMgr().getPrivateData().origin || window.location.origin,
                href: href,
                title: doc.title,
                mode: mode,
                timeoutMs: 10000
            });
        }).then(function (result) {
            var accepted = result.publishResults.filter(function (r) {
                return r.accepted;
            }).length;
            APP.shareStatus = accepted ?
                'Sent to ' + accepted + ' relay(s).' :
                'No relay accepted the share.';
            render();
        }).catch(function (err) {
            console.error(err);
            if (isWalletSessionError(err)) {
                APP.shareStatus = isWalletAccountMismatch(err) ?
                    getShareErrorMessage(err) : 'Unlock your wallet first.';
                handleWalletSessionRequired(APP.shareStatus);
                render();
                return;
            }
            APP.shareStatus = getShareErrorMessage(err);
            render();
            UI.warn(APP.shareStatus);
        });
    };

    var fetchInbox = function () {
        var ShareWorkflow = window.PostFiatPrivateShare;
        if (!ShareWorkflow || typeof(ShareWorkflow.fetchAndOpenLivePadPrivateShares) !== 'function') {
            UI.warn('Post Fiat inbox is unavailable.');
            return;
        }
        var relayList = parseRelayInput($('#pft-inbox-relays').val() || getPostFiatRelays().join('\n'));
        APP.inboxLoading = true;
        APP.inboxStatus = 'Refreshing...';
        render();
        getSessionWallet().then(function (session) {
            return ShareWorkflow.fetchAndOpenLivePadPrivateShares({
                recipientMnemonic: session.mnemonic,
                relayUrls: relayList,
                postFiatConfig: ApiConfig.postFiat,
                fallbackRelays: relayList,
                origin: common.getMetadataMgr().getPrivateData().origin || window.location.origin,
                limit: 50,
                timeoutMs: 10000
            });
        }).then(function (inbox) {
            APP.inbox = inbox.shares || [];
            APP.inboxLoaded = true;
            APP.inboxStatus = inbox.failures && inbox.failures.length ?
                inbox.failures.length + ' message(s) could not be decrypted.' : 'Refreshed.';
            APP.inboxLoading = false;
            render();
        }).catch(function (err) {
            console.error(err);
            APP.inbox = [];
            APP.inboxLoaded = true;
            APP.inboxLoading = false;
            if (isWalletSessionError(err)) {
                APP.inboxStatus = isWalletAccountMismatch(err) ?
                    'Unlocked wallet does not match this workspace account.' :
                    'Unlock your wallet first.';
                handleWalletSessionRequired(APP.inboxStatus);
                render();
                return;
            }
            APP.inboxStatus = err.message || 'Unable to refresh inbox.';
            render();
        });
    };

    var saveInboxPayload = function (payload) {
        var href = payload && payload.href;
        if (!href) { return void UI.warn(Messages.error); }
        queryOuter('Q_STORE_IN_TEAM', {
            href: href,
            password: payload.password,
            path: ['root'],
            title: payload.title || '',
            teamId: -1
        }).then(function () {
            UI.log(Messages.saved);
            return loadDrive();
        }).then(render).catch(function (err) {
            console.error(err);
            UI.warn(Messages.error);
        });
    };

    var copyInboxDirectory = function () {
        var ShareWorkflow = window.PostFiatPrivateShare;
        if (!ShareWorkflow || typeof(ShareWorkflow.buildOwnNostrInboxDirectory) !== 'function') {
            UI.warn('Post Fiat sharing is unavailable.');
            return;
        }
        var relayList = parseRelayInput($('#pft-settings-relays').val() || getPostFiatRelays().join('\n'));
        APP.settingsStatus = 'Building inbox...';
        render();
        getSessionWallet().then(function (session) {
            return ShareWorkflow.buildOwnNostrInboxDirectory({
                mnemonic: session.mnemonic,
                postFiatConfig: ApiConfig.postFiat,
                fallbackRelays: relayList,
                origin: common.getMetadataMgr().getPrivateData().origin || window.location.origin
            });
        }).then(function (directory) {
            APP.inboxDirectory = directory;
            APP.inboxDirectoryState = 'copied';
            APP.inboxPublishedRelays = [];
            APP.inboxPublishFailures = [];
            copyText(JSON.stringify(directory, null, 2), 'Inbox copied.');
            APP.settingsStatus = 'Inbox JSON copied. Wallet-address sharing still needs a published inbox.';
            render();
        }).catch(function (err) {
            console.error(err);
            if (isWalletSessionError(err)) {
                APP.settingsStatus = isWalletAccountMismatch(err) ?
                    'Unlocked wallet does not match this workspace account.' :
                    'Unlock your wallet first.';
                handleWalletSessionRequired(APP.settingsStatus);
                render();
                return;
            }
            APP.settingsStatus = err.message || 'Unable to build inbox.';
            render();
        });
    };

    var publishInboxDirectory = function () {
        var ShareWorkflow = window.PostFiatPrivateShare;
        if (!ShareWorkflow || typeof(ShareWorkflow.publishOwnNostrInboxDirectory) !== 'function') {
            UI.warn('Post Fiat sharing is unavailable.');
            return;
        }
        var relayList = parseRelayInput($('#pft-settings-relays').val() || getPostFiatRelays().join('\n'));
        APP.inboxDirectoryState = 'publishing';
        APP.inboxPublishedRelays = [];
        APP.inboxPublishFailures = [];
        APP.settingsStatus = 'Publishing inbox...';
        render();
        getSessionWallet().then(function (session) {
            return ShareWorkflow.publishOwnNostrInboxDirectory({
                mnemonic: session.mnemonic,
                postFiatConfig: ApiConfig.postFiat,
                fallbackRelays: relayList,
                relayUrls: relayList,
                origin: common.getMetadataMgr().getPrivateData().origin || window.location.origin,
                timeoutMs: 10000
            });
        }).then(function (published) {
            var acceptedResults = published.publishResults.filter(function (r) {
                return r.accepted;
            });
            var rejectedResults = published.publishResults.filter(function (r) {
                return !r.accepted;
            });
            var accepted = acceptedResults.length;
            APP.inboxDirectory = published.directory;
            APP.inboxPublishedRelays = acceptedResults.map(function (r) { return r.relayUrl; });
            APP.inboxPublishFailures = rejectedResults;
            APP.inboxDirectoryState = accepted ? 'published' : 'failed';
            if (accepted) {
                APP.settingsStatus = 'Sharing inbox published for ' + published.directory.walletAddress +
                    ' on ' + accepted + ' relay(s).';
                UI.log(APP.settingsStatus);
            } else {
                APP.settingsStatus = 'Inbox was not published. No relay accepted it.';
                UI.warn(APP.settingsStatus);
            }
            render();
        }).catch(function (err) {
            console.error(err);
            if (isWalletSessionError(err)) {
                APP.settingsStatus = isWalletAccountMismatch(err) ?
                    'Unlocked wallet does not match this workspace account.' :
                    'Unlock your wallet first.';
                handleWalletSessionRequired(APP.settingsStatus);
                render();
                return;
            }
            APP.settingsStatus = err.message || 'Unable to publish inbox.';
            render();
        });
    };

    var renderShell = function (content, aside) {
        var metadataMgr = common && common.getMetadataMgr();
        var user = metadataMgr ? metadataMgr.getUserData() : {};
        var account = APP.wallet && APP.wallet.address || user.name || 'Wallet';
        var shortAccount = shortText(account);
        var nav = Object.keys(routeLabels).map(function (route) {
            var active = APP.route === route;
            var icons = {
                docs: 'drive',
                shared: 'inbox',
                sent: 'share',
                contacts: 'contacts',
                durable: 'upload',
                settings: 'settings',
            };
            var item = h('button.pft-nav-item' + (active ? '.pft-active' : ''), {
                type: 'button'
            }, [icon(icons[route]), h('span', routeLabels[route])]);
            $(item).on('click', function () { setRoute(route); });
            return item;
        });
        var newButtons = appTypes.map(function (entry) {
            var b = button('pft-new-option', entry.label, entry.type === 'pad' ? 'pad' : entry.type);
            $(b).on('click', function () {
                common.openURL('/' + entry.type + '/');
            });
            return b;
        });
        var walletAction = APP.wallet ?
            button('pft-secondary-button pft-wallet-action', 'Lock wallet', 'lock', { title: 'Lock wallet' }) :
            button('pft-secondary-button pft-wallet-action', 'Unlock wallet', 'login', {
                title: 'Unlock wallet'
            });
        $(walletAction).on('click', function () {
            if (APP.wallet) {
                lockWalletSession();
                return;
            }
            openWalletUnlock();
        });
        return h('div.pft-shell', [
            h('aside.pft-sidebar', [
                h('div.pft-brand', [
                    h('div.pft-brand-mark', 'PF'),
                    h('div', [
                        h('div.pft-brand-name', 'Post Fiat Docs'),
                        h('div.pft-brand-subtitle', 'Private workspace')
                    ])
                ]),
                h('nav.pft-nav', nav),
                h('div.pft-sidebar-footer', [
                    h('a.pft-legacy-link', { href: '/drive/' }, 'Legacy Drive')
                ])
            ]),
            h('div.pft-main', [
                h('header.pft-topbar', [
                    h('div.pft-search-wrap', [
                        icon('search'),
                        h('input.pft-search', {
                            placeholder: 'Search docs',
                            value: APP.search
                        })
                    ]),
                    h('div.pft-new-menu', [
                        button('pft-primary-button', 'New', 'add'),
                        h('div.pft-new-popover', newButtons)
                    ]),
                    h('div.pft-wallet-chip', [
                        h('span.pft-wallet-dot' + (APP.wallet ? '.pft-ok' : '.pft-warn')),
                        h('span.pft-wallet-address', shortAccount),
                        h('span.pft-wallet-state', APP.walletStatus)
                    ]),
                    walletAction
                ]),
                h('main.pft-content', content)
            ]),
            aside || h('div')
        ]);
    };

    var renderDocs = function () {
        var filtered = APP.docs.filter(function (doc) {
            if (doc.trash) { return false; }
            if (!APP.search) { return true; }
            return doc.title.toLowerCase().indexOf(APP.search.toLowerCase()) !== -1 ||
                doc.type.toLowerCase().indexOf(APP.search.toLowerCase()) !== -1;
        });
        var rows = filtered.map(function (doc) {
            var openButton = button('pft-table-button', 'Open', 'external-link');
            var shareButton = button('pft-table-button', 'Share', 'share');
            var copyButton = button('pft-table-button', 'Copy link', 'link');
            $(openButton).on('click', function () { openHref(getDocHref(doc, 'edit')); });
            $(shareButton).on('click', function () {
                APP.shareDoc = doc;
                APP.shareStatus = '';
                render();
            });
            $(copyButton).on('click', function () {
                copyText(getDocHref(doc, 'edit'), 'Link copied.');
            });
            return h('tr', [
                h('td.pft-doc-title-cell', [
                    h('div.pft-doc-icon', doc.type.slice(0, 1).toUpperCase()),
                    h('div', [
                        h('div.pft-doc-title', doc.title),
                        h('div.pft-doc-subtitle', getDocHref(doc, 'view').slice(0, 92))
                    ])
                ]),
                h('td', h('span.pft-pill', doc.type)),
                h('td', doc.atime ? new Date(doc.atime).toLocaleString() : ''),
                h('td.pft-table-actions', [openButton, shareButton, copyButton])
            ]);
        });
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Docs'),
                    h('div.pft-view-meta', filtered.length + ' active document(s)')
                ]),
                h('div.pft-filter-row', [
                    h('span.pft-filter.pft-active', 'Active'),
                    h('span.pft-filter', 'Recent'),
                    h('span.pft-filter', 'Owned')
                ])
            ]),
            filtered.length ? h('div.pft-table-wrap', [
                h('table.pft-table', [
                    h('thead', h('tr', [
                        h('th', 'Document'),
                        h('th', 'Type'),
                        h('th', 'Last opened'),
                        h('th', 'Actions')
                    ])),
                    h('tbody', rows)
                ])
            ]) : h('div.pft-empty', [
                h('h2', 'No documents'),
                h('div.pft-empty-actions', appTypes.slice(0, 3).map(function (entry) {
                    var b = button('pft-secondary-button', entry.label, entry.type);
                    $(b).on('click', function () { common.openURL('/' + entry.type + '/'); });
                    return b;
                }))
            ])
        ]);
    };

    var renderShared = function () {
        var relays = h('textarea.pft-textarea#pft-inbox-relays', {
            rows: 2,
            spellcheck: false
        }, getPostFiatRelays().join('\n'));
        var refresh = button('pft-primary-button', APP.inboxLoading ? 'Refreshing' : 'Refresh', 'refresh');
        $(refresh).on('click', fetchInbox);
        var rows = APP.inbox.map(function (share) {
            var payload = share.payload || {};
            var openButton = button('pft-table-button', 'Open', 'external-link');
            var saveButton = button('pft-table-button', 'Save', 'drive');
            $(openButton).on('click', function () { openHref(payload.href); });
            $(saveButton).on('click', function () { saveInboxPayload(payload); });
            return h('tr', [
                h('td.pft-doc-title-cell', [
                    h('div.pft-doc-icon', 'S'),
                    h('div', [
                        h('div.pft-doc-title', payload.title || 'Untitled document'),
                        h('div.pft-doc-subtitle', payload.sharedByWallet || share.senderPublicKeyHex || '')
                    ])
                ]),
                h('td', h('span.pft-pill', payload.mode || 'view')),
                h('td', payload.createdAt ? new Date(payload.createdAt).toLocaleString() : ''),
                h('td.pft-table-actions', [openButton, saveButton])
            ]);
        });
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Shared with me'),
                    h('div.pft-view-meta', APP.inboxStatus || 'Encrypted relay inbox')
                ]),
                refresh
            ]),
            h('div.pft-panel', [
                h('label.pft-label', { for: 'pft-inbox-relays' }, 'Relays'),
                relays
            ]),
            rows.length ? h('div.pft-table-wrap', [
                h('table.pft-table', [
                    h('thead', h('tr', [
                        h('th', 'Document'),
                        h('th', 'Access'),
                        h('th', 'Received'),
                        h('th', 'Actions')
                    ])),
                    h('tbody', rows)
                ])
            ]) : h('div.pft-empty', [
                h('h2', APP.inboxLoaded ? 'No private shares' : 'Inbox not refreshed')
            ])
        ]);
    };

    var renderSent = function () {
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Sent'),
                    h('div.pft-view-meta', 'Private share delivery records')
                ])
            ]),
            h('div.pft-empty', [
                h('h2', 'No sent records'),
                h('p', 'Sent-share history is not enabled yet.')
            ])
        ]);
    };

    var renderContacts = function () {
        var rows = APP.contacts.map(function (contact) {
            var shareButton = button('pft-table-button', 'Share', 'share');
            $(shareButton).on('click', function () {
                setRoute('docs');
            });
            return h('tr', [
                h('td', contact.name || contact.walletAddress || 'Contact'),
                h('td.pft-mono', contact.walletAddress || ''),
                h('td.pft-mono', contact.publicKeyHex || ''),
                h('td.pft-table-actions', [shareButton])
            ]);
        });
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Contacts'),
                    h('div.pft-view-meta', APP.contacts.length + ' saved recipient(s)')
                ])
            ]),
            rows.length ? h('div.pft-table-wrap', [
                h('table.pft-table', [
                    h('thead', h('tr', [
                        h('th', 'Name'),
                        h('th', 'Wallet'),
                        h('th', 'Nostr key'),
                        h('th', 'Actions')
                    ])),
                    h('tbody', rows)
                ])
            ]) : h('div.pft-empty', [
                h('h2', 'No contacts')
            ])
        ]);
    };

    var renderDurable = function () {
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Durable'),
                    h('div.pft-view-meta', 'Explicit PFTL/IPFS publishing')
                ])
            ]),
            h('div.pft-warning-panel', [
                h('h2', 'Publication review required'),
                h('ul', [
                    h('li', 'CIDs and pinning activity can be observable.'),
                    h('li', 'Ledger pointers can be durable.'),
                    h('li', 'Revocation requires content and key rotation.')
                ]),
                button('pft-secondary-button', 'Open legacy durable tools', 'external-link')
            ])
        ]);
    };

    var renderSettings = function () {
        var walletAddress = APP.wallet && APP.wallet.address || '';
        var directory = APP.inboxDirectory;
        var inboxReady = APP.inboxDirectoryState === 'published' &&
            APP.inboxPublishedRelays.length > 0;
        var inboxFailed = APP.inboxDirectoryState === 'failed';
        var inboxCopied = APP.inboxDirectoryState === 'copied';
        var inboxPublishing = APP.inboxDirectoryState === 'publishing';
        var inboxStatus = APP.settingsStatus || (walletAddress ?
            (inboxReady ? 'Ready for wallet shares.' : 'Sharing inbox not published.') :
            'Wallet locked.');
        var inboxStatusClass = inboxReady ? '.pft-ok' : (inboxFailed ? '.pft-error' :
            (walletAddress ? '.pft-warn' : ''));
        var inboxDotClass = inboxReady ? '.pft-ok' : (inboxFailed ? '.pft-error' : '');
        var pillClass = inboxReady ? '.pft-ok' : (inboxFailed ? '.pft-error' : '.pft-warn');
        var pillText = inboxReady ? 'Published' : (inboxFailed ? 'Publish failed' :
            (inboxPublishing ? 'Publishing' : (inboxCopied ? 'Copied' : 'Not published')));
        var relayFailures = APP.inboxPublishFailures.map(getRelayFailureMessage);
        var relays = h('textarea.pft-textarea#pft-settings-relays', {
            rows: 3,
            spellcheck: false
        }, getPostFiatRelays().join('\n'));
        var copyInbox = button('pft-secondary-button', 'Copy inbox JSON', 'copy');
        var publishInbox = button('pft-primary-button', 'Publish inbox', 'upload');
        var loginVault = button('pft-secondary-button', APP.wallet ? 'Wallet vault' : 'Unlock wallet', 'login');
        $(copyInbox).on('click', copyInboxDirectory);
        $(publishInbox).on('click', publishInboxDirectory);
        $(loginVault).on('click', function () {
            openTopLevel(APP.wallet ? '/login/#wallet-vault' : '/login/#unlock-wallet');
        });
        return h('section.pft-view', [
            h('div.pft-view-header', [
                h('div', [
                    h('h1', 'Settings'),
                    h('div.pft-view-meta', 'Wallet and relay state')
                ])
            ]),
            h('div.pft-settings-grid', [
                h('section.pft-panel.pft-wide-panel', [
                    h('div.pft-panel-heading', [
                        h('h2', 'Sharing inbox'),
                        h('span.pft-pill' + pillClass, pillText)
                    ]),
                    h('div.pft-settings-summary', [
                        h('div.pft-setting-row', [
                            h('span', 'Share address'),
                            h('span.pft-mono', walletAddress || 'Locked')
                        ]),
                        h('div.pft-setting-row', [
                            h('span', 'Directory key'),
                            h('span.pft-mono', directory && directory.publicKeyHex ?
                                shortText(directory.publicKeyHex) : 'Not published')
                        ]),
                        h('div.pft-setting-row', [
                            h('span', 'Published relays'),
                            h('span.pft-mono', APP.inboxPublishedRelays.length ?
                                APP.inboxPublishedRelays.join(', ') : 'None')
                        ])
                    ]),
                    h('label.pft-label', { for: 'pft-settings-relays' }, 'Private relay list'),
                    relays,
                    h('div.pft-inbox-status' + inboxStatusClass, [
                        h('span.pft-wallet-dot' + inboxDotClass),
                        h('span', inboxStatus)
                    ]),
                    relayFailures.length ? h('div.pft-relay-failures.pft-mono',
                        relayFailures.join(' | ')) : '',
                    h('div.pft-actions-row', [publishInbox, copyInbox, loginVault])
                ])
            ])
        ]);
    };

    var renderShareAside = function () {
        if (!APP.shareDoc) { return; }
        var relays = h('textarea.pft-textarea#pft-share-relays', {
            rows: 3,
            spellcheck: false
        }, getPostFiatRelays().join('\n'));
        var close = button('pft-icon-button', 'Close', 'close', { title: 'Close share' });
        var send = button('pft-primary-button', 'Send private share', 'share');
        $(close).on('click', function () {
            APP.shareDoc = null;
            APP.shareStatus = '';
            render();
        });
        $(send).on('click', shareDocument);
        return h('aside.pft-share-aside', [
            h('div.pft-aside-header', [
                h('div', [
                    h('h2', 'Share to wallet'),
                    h('div.pft-view-meta', APP.shareDoc.title)
                ]),
                close
            ]),
            h('label.pft-label', { for: 'pft-share-recipient' }, 'Recipient'),
            h('input.pft-input#pft-share-recipient', {
                placeholder: 'Wallet address or contact inbox',
                autocomplete: 'off'
            }),
            h('div.pft-segmented', [
                h('label', [
                    h('input', { type: 'radio', name: 'pft-share-mode', value: 'edit', checked: true }),
                    h('span', 'Edit')
                ]),
                h('label', [
                    h('input', { type: 'radio', name: 'pft-share-mode', value: 'view' }),
                    h('span', 'View')
                ])
            ]),
            h('label.pft-label', { for: 'pft-share-relays' }, 'Relays'),
            relays,
            h('div.pft-aside-status', APP.shareStatus),
            h('div.pft-actions-row', [send])
        ]);
    };

    var renderRoute = function () {
        if (APP.route === 'shared') { return renderShared(); }
        if (APP.route === 'sent') { return renderSent(); }
        if (APP.route === 'contacts') { return renderContacts(); }
        if (APP.route === 'durable') { return renderDurable(); }
        if (APP.route === 'settings') { return renderSettings(); }
        return renderDocs();
    };

    var bindShell = function () {
        $('.pft-search').on('input', function () {
            APP.search = $(this).val();
            render();
        });
        $('.pft-new-menu > .pft-primary-button').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            $('.pft-new-menu').toggleClass('pft-open');
        });
        $(window).off('click.pft-app').on('click.pft-app', function () {
            $('.pft-new-menu').removeClass('pft-open');
        });
        $('.pft-new-menu').on('click', function (e) {
            e.stopPropagation();
        });
        if (APP.route === 'shared' && !APP.inboxLoaded && !APP.inboxLoading) {
            setTimeout(fetchInbox);
        }
    };

    var renderLoggedOut = function () {
        var login = button('pft-primary-button', 'Log in', 'login');
        $(login).on('click', function () { openTopLevel('/login/'); });
        $('#cp-postfiat-app').empty().append(h('div.pft-login-required', [
            h('div.pft-brand-mark', 'PF'),
            h('h1', 'Post Fiat Docs'),
            login
        ]));
        UI.removeLoadingScreen();
        if (!readySent && sframeChan) {
            readySent = true;
            sframeChan.event('EV_POSTFIAT_APP_READY');
        }
    };

    var render = function () {
        if (!common) { return; }
        if (!common.isLoggedIn()) {
            renderLoggedOut();
            return;
        }
        $('#cp-postfiat-app').empty().append(renderShell(renderRoute(), renderShareAside()));
        bindShell();
        UI.removeLoadingScreen();
        if (!readySent && sframeChan) {
            readySent = true;
            sframeChan.event('EV_POSTFIAT_APP_READY');
        }
    };

    var refreshDrive = Util.throttle(function () {
        loadDrive().then(render).catch(function (err) {
            console.error(err);
        });
    }, 500);

    var init = function () {
        sframeChan = common.getSframeChannel();
        common.setTabTitle('Post Fiat Docs');
        if (!common.isLoggedIn()) {
            renderLoggedOut();
            return;
        }
        sframeChan.on('EV_DRIVE_CHANGE', refreshDrive);
        sframeChan.on('EV_DRIVE_REMOVE', refreshDrive);
        sframeChan.on('EV_NETWORK_DISCONNECT', function () {
            APP.walletStatus = 'Offline';
            render();
        });
        sframeChan.on('EV_NETWORK_RECONNECT', function () {
            APP.walletStatus = APP.wallet ? 'Unlocked' : 'Checking';
            refreshDrive();
        });
        Promise.all([
            loadDrive(),
            loadContacts(),
            getSessionWallet().catch(function (err) {
                console.error(err);
                APP.wallet = null;
                APP.walletSession = null;
                clearInboxDirectoryState();
                APP.walletStatus = 'Locked';
            })
        ]).then(render).catch(function (err) {
            console.error(err);
            UI.errorLoadingScreen(Messages.error);
        });
    };

    nThen(function (waitFor) {
        $(waitFor(function () {
            UI.addLoadingScreen();
        }));
        SFCommon.create(waitFor(function (c) {
            common = c;
        }));
    }).nThen(init);
});
