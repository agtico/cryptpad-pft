// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([
    'jquery',
    '/api/config',
    '/common/common-util.js',
    '/common/common-hash.js',
    '/common/common-interface.js',
    '/common/common-ui-elements.js',
    '/common/common-feedback.js',
    '/common/inner/common-modal.js',
    '/common/hyperscript.js',
    '/common/clipboard.js',
    '/customize/messages.js',
    '/components/nthen/index.js',
    '/customize/pages.js',
    '/common/common-icons.js',
    '/common/postfiat-private-share-contacts.js',
    '/common/postfiat-wallet-core.bundle.js',
    '/common/postfiat-private-share.bundle.js',

    '/components/file-saver/FileSaver.min.js',
    '/lib/qrcode.min.js',
], function ($, ApiConfig, Util, Hash, UI, UIElements, Feedback, Modal, h, Clipboard,
             Messages, nThen, Pages, Icons, PostFiatContacts) {
    var Share = {};

    var embeddableApps = [
        'code',
        'form',
        'kanban',
        'pad',
        'slide',
        'whiteboard',
    ].map(app => `/${app}/`);

    var createShareWithFriends = function (config, onShare, linkGetter) {
        var common = config.common;
        var sframeChan = common.getSframeChannel();
        var title = config.title;
        var friends = config.friends || {};
        var teams = config.teams || {};
        var myName = common.getMetadataMgr().getUserData().name;
        var order = [];

        var smallCurves = Object.keys(friends).map(function (c) {
            return friends[c].curvePublic.slice(0,8);
        });

        var div = h('div.contains-nav');
        var $div = $(div);
        // Replace "copy link" by "share with friends" if at least one friend is selected
        // Also create the "share with friends" button if it doesn't exist
        var refreshButtons = function () {
            var $nav = $div.closest('.alertify').find('nav');

            var friendMode = $div.find('.cp-usergrid-user.cp-selected').length;
            if (friendMode) {
                $nav.find('button.cp-share-with-friends').prop('disabled', '');
            } else {
                $nav.find('button.cp-share-with-friends').prop('disabled', 'disabled');
            }
        };

        config.noInclude = true;
        Object.keys(friends).forEach(function (curve) {
            var data = friends[curve];
            if (curve.length > 40 && data.notifications) { return; }
            delete friends[curve];
        });

        var others = [];
        if (Object.keys(friends).length) {
            var friendsList = UIElements.getUserGrid(Messages.share_linkFriends, {
                common: common,
                data: friends,
                noFilter: false,
                large: true
            }, refreshButtons);
            var friendDiv = friendsList.div;
            $div.append(friendDiv);
            others = friendsList.icons;
        }

        if (Object.keys(teams).length) {
            var teamsList = UIElements.getUserGrid(Messages.share_linkTeam, {
                common: common,
                noFilter: true,
                large: true,
                data: teams
            }, refreshButtons);
            $div.append(teamsList.div);
        }

        var shareButton = {
            className: 'primary cp-share-with-friends',
            name: Messages.share_withFriends,
            iconClass: 'share',
            onClick: function () {
                var href;
                nThen(function (waitFor) {
                    var w = waitFor();
                    // linkGetter can be async if this is a burn after reading URL
                    var res = linkGetter({}, function (url) {
                        if (!url) {
                            waitFor.abort();
                            return;
                        }
                        href = url;
                        setTimeout(w);
                    });
                    if (res && /^http/.test(res)) {
                        var _href = Hash.getRelativeHref(res);
                        if (_href) { href = _href; }
                        else {
                            href = res;
                        }
                        setTimeout(w);
                        return;
                    }
                }).nThen(function () {
                    var $friends = $div.find('.cp-usergrid-user.cp-selected');
                    $friends.each(function (i, el) {
                        var curve = $(el).attr('data-curve');
                        var ed = $(el).attr('data-ed');
                        var friend = curve && friends[curve];
                        var team = teams[ed];
                        // If the selected element is a friend or a team without edit right,
                        // send a notification
                        var mailbox = friend || ((team && team.viewer) ? team : undefined);
                        if (mailbox) { // Friend
                            if (friends[curve] && !mailbox.notifications) { return; }
                            if (mailbox.notifications && mailbox.curvePublic) {
                                common.mailbox.sendTo("SHARE_PAD", {
                                    href: href,
                                    isStatic: Boolean(config.static),
                                    password: config.password,
                                    isTemplate: config.isTemplate,
                                    name: myName,
                                    isCalendar: Boolean(config.calendar),
                                    title: title
                                }, {
                                    viewed: team && team.id,
                                    channel: mailbox.notifications,
                                    curvePublic: mailbox.curvePublic
                                });
                                if (config.static) {
                                    Feedback.send("LINK_SHARED_WITH_CONTACT");
                                }
                                return;
                            }
                        }
                        // If it's a team with edit right, add the pad directly
                        if (!team) { return; }
                        if (config.calendar) {
                            var calendarModule = common.makeUniversal('calendar');
                            var calendarData = config.calendar;
                            calendarData.href = href;
                            calendarData.teamId = team.id;
                            calendarModule.execCommand('ADD', calendarData, function (obj) {
                                if (obj && obj.error) {
                                    console.error(obj.error);
                                    return void UI.warn(Messages.error);
                                }
                            });
                            return;
                        }
                        if (config.static) {
                            common.getSframeChannel().query("Q_DRIVE_USEROBJECT", {
                                cmd: "addLink",
                                teamId: team.id,
                                data: {
                                    name: title,
                                    href: href,
                                    path: ['root']
                                }
                            }, function () {
                                UI.log(Messages.saved);
                            });
                            Feedback.send("LINK_ADDED_TO_DRIVE");
                            return;
                        }
                        sframeChan.query('Q_STORE_IN_TEAM', {
                            href: href,
                            password: config.password,
                            path: config.isTemplate ? ['template'] : undefined,
                            title: title,
                            teamId: team.id
                        }, function (err) {
                            if (err) { return void console.error(err); }
                        });
                    });

                    UI.findCancelButton().click();

                    // Update the "recently shared with" array:
                    // Get the selected curves
                    var curves = $friends.toArray().map(function (el) {
                        return ($(el).attr('data-curve') || '').slice(0,8);
                    }).filter(function (x) { return x; });
                    // Prepend them to the "order" array
                    Array.prototype.unshift.apply(order, curves);
                    order = Util.deduplicateString(order);
                    // Make sure we don't have "old" friends and save
                    order = order.filter(function (curve) {
                        return smallCurves.indexOf(curve) !== -1;
                    });
                    common.setAttribute(['general', 'share-friends'], order);
                    if (onShare) {
                        onShare.fire();
                    }
                });
            },
            keys: [13]
        };

        common.getAttribute(['general', 'share-friends'], function (err, val) {
            order = val || [];
            // Sort friends by "recently shared with"
            others.sort(function (a, b) {
                var ca = ($(a).attr('data-curve') || '').slice(0,8);
                var cb = ($(b).attr('data-curve') || '').slice(0,8);
                if (!ca && !cb) { return 0; }
                if (!ca) { return 1; }
                if (!cb) { return -1; }
                var ia = order.indexOf(ca);
                var ib = order.indexOf(cb);
                if (ia === -1 && ib === -1) { return 0; }
                if (ia === -1) { return 1; }
                if (ib === -1) { return -1; }
                return ia - ib;
            });
            // Reorder the friend icons
            others.forEach(function (el, i) {
                $(el).attr('data-order', i).css('order', i);
            });
            // Display them
            $(friendDiv).find('.cp-usergrid-grid').detach();
            $(friendDiv).append(h('div.cp-usergrid-grid', others));
            refreshButtons();
        });
        return {
            content: div,
            buttons: [shareButton]
        };
    };

    var getEditableTeams = function (common, config) {
        var privateData = common.getMetadataMgr().getPrivateData();
        var teamsData = Util.tryParse(JSON.stringify(privateData.teams)) || {};
        var teams = {};
        Object.keys(teamsData).forEach(function (id) {
            // config.teamId only exists when we're trying to share a pad from a team drive
            // In this case, we don't want to share the pad with the current team
            if (config.teamId && config.teamId === id) { return; }
            var t = teamsData[id];
            teams[t.edPublic] = {
                viewer: !teamsData[id].hasSecondaryKey,
                notifications: t.notifications,
                curvePublic: t.curvePublic,
                displayName: t.name,
                edPublic: t.edPublic,
                avatar: t.avatar,
                id: id
            };
        });
        return teams;
    };
    const makeBurnAfterReadingUrl = (common, href, channel, opts, cb) => {
        const keyPair = Hash.generateSignPair();
        const parsed = Hash.parsePadUrl(href);
        const newHref = parsed.getUrl({
            ownerKey: keyPair.safeSignKey
        });
        const sframeChan = common.getSframeChannel();
        const priv = common.getMetadataMgr().getPrivateData();
        const { otherChan } = Modal.getOtherChans(priv, opts);
        nThen((waitFor) => {
            sframeChan.query('Q_SET_PAD_METADATA', {
                channel: channel,
                channels: otherChan,
                command: 'ADD_OWNERS',
                value: [keyPair.validateKey]
            }, waitFor((err) => {
                if (err) {
                    waitFor.abort();
                    UI.warn(Messages.error);
                }
            }));
        }).nThen(() => {
            cb(newHref);
        });
    };

    var makeFaqLink = function (opts) {
        var link = h('span', [
            Icons.get('help'),
            h('a', {href: '#'}, Messages.passwordFaqLink)
        ]);
        $(link).click(function () {
            opts.common.openUnsafeURL(Pages.localizeDocsLink("https://docs.cryptpad.org/en/user_guide/security.html#passwords-for-documents-and-folders"));
        });
        return link;
    };

    var makeCancelButton = function() {
        return {
            className: 'cancel',
            name: Messages.cancel,
            onClick: function () {},
            keys: [27]
        };
    };

    var getContactsTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var common = Env.common;

        var hasFriends = opts.hasFriends;
        var onFriendShare = Util.mkEvent();

        var metadataMgr = common.getMetadataMgr();
        var priv = metadataMgr.getPrivateData();
        if (priv.offline) {
            return void cb(void 0, {
                content: h('p', Messages.share_noContactsOffline),
                buttons: [{
                    className: 'cancel',
                    name: Messages.filePicker_close,
                    onClick: function () {},
                    keys: [27]
                }]
            });
        }

        var friendsObject = hasFriends ? createShareWithFriends(opts, onFriendShare, opts.getLinkValue) : UIElements.noContactsMessage(common);
        var friendsList = friendsObject.content;

        onFriendShare.reg(opts.saveValue);

        var contactsContent = h('div.cp-share-modal');
        var $contactsContent = $(contactsContent);
        $contactsContent.append(friendsList);

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            $contactsContent.append(h('div.alert.alert-primary', [
                Icons.get('access'),
                Messages.share_contactPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        // Burn after reading warning
        if (opts.barAlert) { $contactsContent.append(opts.barAlert.cloneNode(true)); }

        var contactButtons = friendsObject.buttons;
        contactButtons.unshift(makeCancelButton());

        cb(void 0, {
            content: contactsContent,
            buttons: contactButtons
        });
    };

    var getPostFiatRelays = function () {
        var nostr = (ApiConfig.postFiat && ApiConfig.postFiat.nostr) || {};
        var relays = Array.isArray(nostr.privateRelays) && nostr.privateRelays.length ?
            nostr.privateRelays : nostr.relays;
        return Array.isArray(relays) ? relays : [];
    };

    var parsePostFiatRelayInput = function (value) {
        return String(value || '').split(/[\s,]+/u)
            .map(function (relay) { return relay.trim(); })
            .filter(Boolean);
    };

    var isPostFiatWalletAddress = function (value) {
        return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/u.test(String(value || '').trim());
    };

    var findSavedPostFiatRecipient = function (value, contacts) {
        var text = String(value || '').trim().toLowerCase();
        if (!text) { return; }
        for (var i = 0; i < contacts.length; i += 1) {
            var contact = contacts[i];
            var candidates = [
                contact.walletAddress,
                contact.label,
                contact.publicKeyHex,
                contact.id
            ].filter(Boolean).map(function (candidate) {
                return String(candidate).trim().toLowerCase();
            });
            if (candidates.indexOf(text) !== -1) {
                return PostFiatContacts.toRecipient(contact);
            }
        }
    };

    var parsePostFiatRecipientInput = function (value, relays, contacts) {
        var text = String(value || '').trim();
        if (!text) { throw new Error('MISSING_POSTFIAT_RECIPIENT'); }
        var savedRecipient = findSavedPostFiatRecipient(text, contacts || []);
        var recipient = savedRecipient || (text[0] === '{' ?
            JSON.parse(text) : isPostFiatWalletAddress(text) ?
                { walletAddress: text } : { publicKeyHex: text });
        if (!Array.isArray(recipient.relays) || !recipient.relays.length) {
            recipient.relays = relays;
        }
        return recipient;
    };

    var getPostFiatShareMode = function (opts) {
        if (!opts.$rights) { return 'edit'; }
        return Util.isChecked(opts.$rights.find('#cp-share-editable-true')) ? 'edit' : 'view';
    };

    var getPostFiatWalletCore = function () {
        var Core = window.PostFiatWalletCore;
        if (!Core) {
            throw new Error('POSTFIAT_WALLET_CORE_UNAVAILABLE');
        }
        return Core;
    };

    var getPostFiatSessionWallet = async function () {
        var Core = getPostFiatWalletCore();
        if (!Core || typeof(Core.restoreSessionWallet) !== 'function') {
            throw new Error('POSTFIAT_WALLET_CORE_UNAVAILABLE');
        }
        var session = await Core.restoreSessionWallet();
        if (!session && typeof(Core.requestSessionWallet) === 'function') {
            session = await Core.requestSessionWallet({ timeoutMs: 1200 });
        }
        if (!session || !session.mnemonic) {
            throw new Error('POSTFIAT_WALLET_SESSION_REQUIRED');
        }
        return session;
    };

    var getPostFiatTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var common = Env.common;
        var relays = getPostFiatRelays();
        var ShareWorkflow = window.PostFiatPrivateShare;
        var savedContacts = [];
        var activePostFiatSession = null;
        var walletUnlockAttempt = 0;
        try {
            var WalletCore = getPostFiatWalletCore();
            if (typeof(WalletCore.startSessionWalletResponder) === 'function') {
                WalletCore.startSessionWalletResponder();
            }
        } catch (err) {
            console.error(err);
        }

        var savedWalletAddress = h('span.cp-share-pft-saved-wallet-address');
        var savedWalletPassword = h('input.form-control#cp-share-pft-saved-wallet-password', {
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Wallet password'
        });
        var unlockSavedButton = h('button.btn.btn-secondary.cp-share-pft-unlock-saved', {
            type: 'button'
        }, [Icons.get('lock'), 'Unlock saved']);
        var savedWalletUnlock = h('div.cp-share-pft-saved-wallet.cp-hidden', {
            style: 'display: none;'
        }, [
            h('label.cp-default-label', { for: 'cp-share-pft-saved-wallet-password' }, 'Saved wallet password'),
            h('div.cp-share-pft-saved-wallet-meta', savedWalletAddress),
            savedWalletPassword,
            h('div.cp-spacer'),
            unlockSavedButton
        ]);
        var openLoginButton = h('button.btn.btn-secondary.cp-share-pft-open-login', {
            type: 'button'
        }, [Icons.get('login'), 'Open wallet login']);
        var noSavedWallet = h('div.cp-share-pft-no-saved-wallet.cp-hidden', {
            style: 'display: none;'
        }, [
            h('div.cp-default-label', 'No saved wallet found'),
            h('p', 'Save an encrypted Post Fiat wallet on this browser before sharing.'),
            h('div.cp-spacer'),
            openLoginButton
        ]);
        var walletStatus = h('div.cp-share-pft-wallet-status', { role: 'status' });
        var walletUnlock = h('div.alert.alert-warning.cp-share-pft-wallet-unlock', [
            h('div.cp-default-label', 'Wallet unlock'),
            savedWalletUnlock,
            noSavedWallet,
            walletStatus
        ]);
        var unlockedAddress = h('span.cp-share-pft-unlocked-address');
        var switchWalletButton = h('button.btn.btn-secondary.cp-share-pft-switch-wallet', {
            type: 'button'
        }, [Icons.get('logout'), 'Use different wallet']);
        var walletSummary = h('div.alert.alert-primary.cp-share-pft-wallet-summary.cp-hidden', {
            style: 'display: none;'
        }, [
            Icons.get('access'),
            h('span', ' Wallet unlocked: '),
            unlockedAddress,
            switchWalletButton
        ]);
        var contactSelect = h('select.form-control#cp-share-pft-contact');
        var recipientInput = h('textarea.form-control#cp-share-pft-recipient', {
            rows: 4,
            spellcheck: false,
            placeholder: 'Wallet address, saved contact, Nostr pubkey, or inbox JSON'
        });
        var relaysInput = h('textarea.form-control#cp-share-pft-relays', {
            rows: 2,
            spellcheck: false,
            placeholder: 'wss://relay.example'
        }, relays.join('\n'));
        var ownDirectory = h('textarea.form-control#cp-share-pft-own-directory', {
            rows: 4,
            readonly: 'readonly',
            spellcheck: false,
            placeholder: 'Unlock wallet to load your inbox JSON'
        });
        var resultOutput = h('textarea.form-control#cp-share-pft-result', {
            rows: 4,
            readonly: 'readonly',
            spellcheck: false,
            placeholder: 'Publish result'
        });
        var status = h('div.cp-share-pft-status', { role: 'status' });
        var content = h('div.cp-share-modal.cp-share-pft', [
            walletSummary,
            walletUnlock,
            h('div.cp-spacer'),
            h('label.cp-default-label', { for: 'cp-share-pft-contact' }, 'Saved recipient'),
            contactSelect,
            h('div.cp-spacer'),
            h('label.cp-default-label', { for: 'cp-share-pft-recipient' }, 'Recipient'),
            recipientInput,
            h('div.cp-spacer'),
            h('label.cp-default-label', { for: 'cp-share-pft-relays' }, 'Relays'),
            relaysInput,
            h('div.cp-spacer'),
            h('label.cp-default-label', { for: 'cp-share-pft-own-directory' }, 'Your inbox'),
            ownDirectory,
            h('div.cp-spacer'),
            h('label.cp-default-label', { for: 'cp-share-pft-result' }, 'Result'),
            resultOutput,
            status
        ]);
        var $content = $(content);

        var setStatus = function (text, warning) {
            $(status).text(text || '').toggleClass('alert alert-warning', Boolean(warning));
        };
        var setWalletStatus = function (text, warning) {
            $(walletStatus).text(text || '').toggleClass('alert alert-warning', Boolean(warning));
        };
        var setWalletUnlockError = function (err, fallback) {
            console.error(err);
            var message = (err && err.message) || fallback || String(err);
            if (err && err.walletUnlocked) {
                setStatus('Wallet unlocked, but inbox could not load: ' + message, true);
                UI.warn('Wallet unlocked, but inbox could not load.');
                return;
            }
            setWalletStatus(fallback || message, true);
            UI.warn(fallback || message);
        };
        var setVisible = function (el, visible) {
            $(el).toggleClass('cp-hidden', !visible);
            $(el).css('display', visible ? '' : 'none');
        };
        var showNoSavedWallet = function () {
            setVisible(savedWalletUnlock, false);
            setVisible(noSavedWallet, true);
        };
        var showSavedUnlock = function () {
            setVisible(noSavedWallet, false);
            setVisible(savedWalletUnlock, true);
        };
        var refreshSavedWalletUnlock = function () {
            try {
                var Core = getPostFiatWalletCore();
                if (typeof(Core.getSavedWalletMeta) !== 'function') {
                    showNoSavedWallet();
                    setWalletStatus('Saved wallet storage is unavailable in this browser.', true);
                    return;
                }
                var meta = Core.getSavedWalletMeta();
                if (!meta || !meta.address) {
                    $(savedWalletAddress).text('');
                    showNoSavedWallet();
                    setWalletStatus('Save an encrypted wallet from the login page before sharing.', true);
                    return;
                }
                $(savedWalletAddress).text(meta.address);
                showSavedUnlock();
            } catch (err) {
                console.error(err);
                showNoSavedWallet();
                setWalletStatus('Saved wallet storage is unavailable in this browser.', true);
            }
        };
        var setWalletUnlocked = function (address) {
            var isUnlocked = Boolean(address);
            setVisible(walletUnlock, !isUnlocked);
            setVisible(walletSummary, isUnlocked);
            $(unlockedAddress).text(address || '');
            if (isUnlocked) {
                setWalletStatus('');
                setStatus('');
            } else {
                refreshSavedWalletUnlock();
            }
        };
        var requireWalletUnlock = function (message) {
            activePostFiatSession = null;
            setWalletUnlocked('');
            setWalletStatus(message || 'Unlock wallet here first.', true);
            UI.warn('Unlock Post Fiat wallet first.');
        };
        var rememberPostFiatSession = function (mnemonic) {
            var Core = getPostFiatWalletCore();
            if (typeof(Core.deriveWalletFromMnemonic) !== 'function') {
                throw new Error('POSTFIAT_WALLET_CORE_UNAVAILABLE');
            }
            var wallet = Core.deriveWalletFromMnemonic(mnemonic);
            activePostFiatSession = {
                mnemonic: wallet.mnemonic,
                wallet: wallet
            };
            return activePostFiatSession;
        };
        var getCurrentPostFiatSessionWallet = async function () {
            if (activePostFiatSession && activePostFiatSession.mnemonic) {
                return activePostFiatSession;
            }
            activePostFiatSession = await getPostFiatSessionWallet();
            return activePostFiatSession;
        };
        var renderContacts = function (contacts) {
            savedContacts = contacts || [];
            var options = [h('option', { value: '' }, 'Paste recipient')];
            savedContacts.forEach(function (contact, i) {
                options.push(h('option', { value: String(i) }, PostFiatContacts.getLabel(contact)));
            });
            $(contactSelect).empty().append(options);
        };
        var loadContacts = function () {
            PostFiatContacts.list(common, function (err, contacts) {
                if (err) { return void console.error(err); }
                renderContacts(contacts);
            });
        };
        $(contactSelect).on('change', function () {
            var value = $(contactSelect).val();
            if (value === '') { return; }
            var index = Number(value);
            var contact = savedContacts[index];
            if (!contact) { return; }
            $(recipientInput).val(JSON.stringify(PostFiatContacts.toRecipient(contact), null, 2));
            if (contact.relays && contact.relays.length) {
                $(relaysInput).val(contact.relays.join('\n'));
            }
        });
        loadContacts();

        var loadOwnDirectory = async function () {
            if (!ShareWorkflow || typeof(ShareWorkflow.buildOwnNostrInboxDirectory) !== 'function') {
                throw new Error('POSTFIAT_SHARE_WORKFLOW_UNAVAILABLE');
            }
            var session = await getCurrentPostFiatSessionWallet();
            var directory = await ShareWorkflow.buildOwnNostrInboxDirectory({
                mnemonic: session.mnemonic,
                postFiatConfig: ApiConfig.postFiat,
                fallbackRelays: parsePostFiatRelayInput($(relaysInput).val()),
                origin: opts.origin || window.location.origin
            });
            $(ownDirectory).val(JSON.stringify(directory, null, 2));
            setWalletUnlocked(directory.walletAddress || (session.wallet && session.wallet.address));
            return directory;
        };

        var unlockWithMnemonic = async function (mnemonic) {
            var Core = getPostFiatWalletCore();
            var session = rememberPostFiatSession(mnemonic);
            if (typeof(Core.createSessionWallet) === 'function') {
                Core.createSessionWallet(session.mnemonic).then(function () {
                    if (typeof(Core.startSessionWalletResponder) === 'function') {
                        Core.startSessionWalletResponder();
                    }
                }).catch(function (err) {
                    console.error(err);
                });
            }
            $(savedWalletPassword).val('');
            setWalletStatus('Wallet unlocked.');
            setWalletUnlocked(session.wallet.address);
            try {
                return await loadOwnDirectory();
            } catch (err) {
                err.walletUnlocked = true;
                throw err;
            }
        };

        $(unlockSavedButton).on('click', function () {
            var password = $(savedWalletPassword).val();
            if (!password) {
                setWalletStatus('Enter the saved wallet password.', true);
                return;
            }
            var attempt = walletUnlockAttempt += 1;
            setWalletStatus('Unlocking saved wallet...');
            try {
                var Core = getPostFiatWalletCore();
                if (typeof(Core.unlockSavedWallet) !== 'function') {
                    throw new Error('POSTFIAT_WALLET_CORE_UNAVAILABLE');
                }
                Core.unlockSavedWallet(password).then(function (saved) {
                    return unlockWithMnemonic(saved.mnemonic);
                }).catch(function (err) {
                    if (attempt !== walletUnlockAttempt) { return; }
                    setWalletUnlockError(err, err && err.walletUnlocked ?
                        undefined : 'Unable to unlock saved wallet.');
                });
            } catch (err) {
                if (attempt !== walletUnlockAttempt) { return; }
                setWalletUnlockError(err, 'Unable to unlock saved wallet.');
            }
        });
        $(savedWalletPassword).on('keydown', function (e) {
            if (e.which !== 13) { return; }
            e.preventDefault();
            $(unlockSavedButton).click();
        });
        $(openLoginButton).on('click', function () {
            common.openURL('/login/#wallet-vault');
        });
        $(switchWalletButton).on('click', function () {
            try {
                var Core = getPostFiatWalletCore();
                if (Core.clearSessionWallet) {
                    Core.clearSessionWallet().catch(function (err) {
                        console.error(err);
                    });
                }
            } catch (err) {
                console.error(err);
            }
            activePostFiatSession = null;
            $(ownDirectory).val('');
            setWalletUnlocked('');
            setWalletStatus('');
        });
        refreshSavedWalletUnlock();

        setTimeout(function () {
            loadOwnDirectory().catch(function () {
                if (activePostFiatSession && activePostFiatSession.mnemonic) { return; }
                setWalletUnlocked('');
                setWalletStatus('Unlock here to publish wallet shares.', true);
            });
        });

        cb(void 0, {
            content: content,
            buttons: [
                makeCancelButton(),
                {
                    className: 'secondary cp-share-pft-copy-inbox',
                    name: 'Copy inbox',
                    iconClass: 'copy',
                    onClick: function () {
                        setStatus('Loading inbox...');
                        loadOwnDirectory().then(function (directory) {
                            Clipboard.copy(JSON.stringify(directory, null, 2), function (err) {
                                if (err) {
                                    setStatus('Unable to copy inbox.', true);
                                    return void UI.warn(Messages.error);
                                }
                                setStatus('Inbox copied.');
                                UI.log(Messages.shareSuccess);
                            });
                        }).catch(function (err) {
                            if (err && err.message === 'POSTFIAT_WALLET_SESSION_REQUIRED') {
                                requireWalletUnlock('Unlock wallet here before copying your inbox.');
                                return;
                            }
                            setStatus(err.message || String(err), true);
                            UI.warn('Unlock your Post Fiat wallet first.');
                        });
                        return true;
                    },
                    keys: []
                }, {
                    className: 'secondary cp-share-pft-publish-inbox',
                    name: 'Publish inbox',
                    iconClass: 'upload',
                    onClick: function () {
                        if (!ShareWorkflow ||
                                typeof(ShareWorkflow.publishOwnNostrInboxDirectory) !== 'function') {
                            UI.warn('Post Fiat private sharing code is unavailable.');
                            return true;
                        }
                        var $button = $('.alertify').find('button.cp-share-pft-publish-inbox');
                        var relayList = parsePostFiatRelayInput($(relaysInput).val());
                        $button.attr('disabled', 'disabled');
                        setStatus('Publishing inbox...');
                        getCurrentPostFiatSessionWallet().then(function (session) {
                            return ShareWorkflow.publishOwnNostrInboxDirectory({
                                mnemonic: session.mnemonic,
                                postFiatConfig: ApiConfig.postFiat,
                                fallbackRelays: relayList,
                                relayUrls: relayList,
                                origin: opts.origin || window.location.origin,
                                timeoutMs: 10000
                            });
                        }).then(function (published) {
                            var accepted = published.publishResults.filter(function (r) {
                                return r.accepted;
                            }).length;
                            $(ownDirectory).val(JSON.stringify(published.directory, null, 2));
                            setWalletUnlocked(published.directory.walletAddress);
                            setStatus(accepted ?
                                'Published inbox to ' + accepted + ' relay(s).' :
                                'No relay accepted the inbox directory.', !accepted);
                            if (accepted) { UI.log(Messages.shareSuccess); }
                            else { UI.warn('No relay accepted the Post Fiat inbox directory.'); }
                        }).catch(function (err) {
                            if (err && err.message === 'POSTFIAT_WALLET_SESSION_REQUIRED') {
                                requireWalletUnlock('Unlock wallet here before publishing your inbox.');
                                return;
                            }
                            setStatus(err.message || String(err), true);
                            UI.warn('Unable to publish Post Fiat inbox.');
                        }).finally(function () {
                            $button.removeAttr('disabled');
                        });
                        return true;
                    },
                    keys: []
                }, {
                    className: 'primary cp-nobar cp-share-pft-publish',
                    name: 'Share to wallet',
                    iconClass: 'share',
                    onClick: function () {
                        if (!ShareWorkflow || typeof(ShareWorkflow.publishLivePadPrivateShare) !== 'function') {
                            UI.warn('Post Fiat private sharing code is unavailable.');
                            return true;
                        }
                        var $button = $('.alertify').find('button.cp-share-pft-publish');
                        var relayList = parsePostFiatRelayInput($(relaysInput).val());
                        opts.saveValue();
                        var href = opts.getLinkValue();
                        if (!/^(\/|https?:\/\/)/u.test(String(href || ''))) {
                            setStatus('Generate a valid document link before publishing.', true);
                            return true;
                        }
                        $button.attr('disabled', 'disabled');
                        setStatus('Publishing...');
                        getCurrentPostFiatSessionWallet().then(function (session) {
                            var recipient = parsePostFiatRecipientInput(
                                $(recipientInput).val(),
                                relayList,
                                savedContacts
                            );
                            return ShareWorkflow.publishLivePadPrivateShare({
                                senderMnemonic: session.mnemonic,
                                recipientDirectory: recipient,
                                postFiatConfig: ApiConfig.postFiat,
                                fallbackRelays: relayList,
                                directoryRelays: relayList,
                                origin: opts.origin || window.location.origin,
                                href: href,
                                title: opts.title || data.title || document.title,
                                mode: getPostFiatShareMode(opts),
                                timeoutMs: 10000
                            });
                        }).then(function (published) {
                            var accepted = published.publishResults.filter(function (r) {
                                return r.accepted;
                            }).length;
                            $content.find('#cp-share-pft-result').val(JSON.stringify({
                                eventId: published.giftWrap.id,
                                relays: published.relays,
                                publishResults: published.publishResults
                            }, null, 2));
                            setStatus(accepted ?
                                'Published to ' + accepted + ' relay(s).' :
                                'No relay accepted the share.', !accepted);
                            if (accepted) { UI.log(Messages.shareSuccess); }
                            else { UI.warn('No relay accepted the Post Fiat share.'); }
                            if (accepted) {
                                PostFiatContacts.upsert(common, {
                                    walletAddress: published.recipient.walletAddress,
                                    publicKeyHex: published.recipient.publicKeyHex,
                                    relays: published.relays
                                }, function (err) {
                                    if (err) { return void console.error(err); }
                                    loadContacts();
                                });
                            }
                        }).catch(function (err) {
                            if (err && err.message === 'POSTFIAT_WALLET_SESSION_REQUIRED') {
                                requireWalletUnlock('Unlock wallet here before sharing.');
                                return;
                            }
                            setStatus(err.message || String(err), true);
                            UI.warn('Unable to publish Post Fiat share.');
                        }).finally(function () {
                            $button.removeAttr('disabled');
                        });
                        return true;
                    },
                    keys: [13]
                }
            ]
        });
    };

    var getLinkTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var common = Env.common;
        var origin = opts.origin;
        var pathname = opts.pathname;
        var hashes = opts.hashes;

        // Create modal
        var linkContent = opts.sharedFolder ? [
            h('label', Messages.sharedFolders_share),
            h('br'),
        ] : [
            UI.createCheckbox('cp-share-embed', Messages.share_linkEmbed, false, { mark: {tabindex:0} }),
        ];

        if (opts.static) { linkContent = []; }

        linkContent.push(h('div.cp-spacer'));
        linkContent.push(UI.dialog.selectableArea('', { id: 'cp-share-link-preview', tabindex: 0, rows:3}));

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            linkContent.push(h('div.alert.alert-primary', [
                Icons.get('lock'),
                Messages.share_linkPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        // warning about sharing links
        // when sharing a version hash, there is a similar warning and we want
        // to avoid alert fatigue
        if (!opts.versionHash && !opts.static) {
            var localStore = window.cryptpadStore;
            var dismissButton = h('span', [Icons.get('close')]);
            var shareLinkWarning = h('div.alert.alert-warning.dismissable',
                { style: 'display: none;' },
                [
                    h('span.cp-inline-alert-text', Messages.share_linkWarning),
                    dismissButton
                ]);
            linkContent.push(shareLinkWarning);

            localStore.get('hide-alert-shareLinkWarning', function (val) {
                if (val === '1') { return; }
                $(shareLinkWarning).css('display', 'flex');

                $(dismissButton).on('click', function () {
                    localStore.put('hide-alert-shareLinkWarning', '1');
                    $(shareLinkWarning).remove();
                });
            });
        }

        // Burn after reading
        if (opts.barAlert) { linkContent.push(opts.barAlert.cloneNode(true)); }

        var link = h('div.cp-share-modal', linkContent);
        var $link = $(link);
        $link.find('#cp-share-link-preview').val(opts.getLinkValue());
        $link.find('input[type="checkbox"]').on('change', function () {
            $link.find('#cp-share-link-preview').val(opts.getLinkValue({
                embed: Util.isChecked($link.find('#cp-share-embed'))
            }));
        });
        var linkButtons = [
            makeCancelButton(),
            !opts.sharedFolder && {
                className: 'secondary cp-nobar',
                name: Messages.share_linkOpen,
                iconClass: 'preview',
                onClick: function () {
                    opts.saveValue();
                    var v = opts.getLinkValue({
                        embed: Util.isChecked($link.find('#cp-share-embed'))
                    });
                    if (opts.static) {
                        common.openUnsafeURL(v);
                        return true;
                    }
                    window.open(v);
                    return true;
                },
                keys: [[13, 'ctrl']]
            }, {
                className: 'primary cp-nobar',
                name: Messages.share_linkCopy,
                iconClass: 'link',
                onClick: function () {
                    opts.saveValue();
                    var v = opts.getLinkValue({
                        embed: Util.isChecked($link.find('#cp-share-embed'))
                    });
                    Clipboard.copy(v, (err) => {
                        if (!err) { UI.log(Messages.shareSuccess); }
                    });
                },
                keys: [13]
            }, {
                className: 'primary cp-bar',
                name:  Messages.share_bar,
                onClick: function () {
                    var barHref = origin + pathname + '#' + (hashes.viewHash || hashes.editHash);
                    makeBurnAfterReadingUrl(common, barHref, opts.channel, opts, function (url) {
                        opts.burnAfterReadingUrl = url;
                        opts.$rights.find('input[type="radio"]').trigger('change');
                    });
                    return true;
                },
                keys: []
            }
        ];

        $link.find('.cp-bar').hide();

        cb(void 0, {
            content: link,
            buttons: linkButtons
        });
    };

    var getQRCode = function (link) {
        var blocker = h('div#cp-qr-blocker', Messages.share_toggleQR);
        var $blocker = $(blocker).click(function () {
            $blocker.toggleClass("hidden");
        });

        var qrDiv = h('div');

        var container = h('div#cp-qr-container', [
            blocker,
            h('div#cp-qr-link-preview', qrDiv),
        ]);

        new window.QRCode(qrDiv, link);
        return container;
    };

    Messages.share_toggleQR = "Click to toggle QR code visibility"; // NEXT
    var getQRTab = function (Env, data, opts, _cb) {
        var qr = getQRCode(opts.getLinkValue());

        var link = h('div.cp-share-modal', [
            h('span#cp-qr-target', qr),
        ]);

        var buttons = [
            makeCancelButton(),
            {
                className: 'primary cp-bar',
                name: Messages.share_bar,
                onClick: function () {
                    UI.warn("OOPS: NOT IMPLEMENTED"); // NEXT
                    return true;
                },
            },
            {
                className: 'primary cp-nobar',
                name: Messages.download_dl,
                iconClass: 'download',
                onClick: function () {
                    qr.querySelector('canvas').toBlob(blob => {
                        var name = Util.fixFileName((opts.title || 'document') + '-qr.png');
                        window.saveAs(blob, name);
                    });
                },
            },
        ];

        return _cb(void 0, {
            content: link,
            buttons: buttons,
        });
    };

    var getEmbedTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));

        var embedContent = [
            h('p', Messages.viewEmbedTag),
            UI.dialog.selectableArea(opts.getEmbedValue(), { id: 'cp-embed-link-preview', tabindex: 0, rows: 3})
        ];

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            embedContent.push(h('div.alert.alert-primary', [
                Icons.get('lock'), ' ',
                Messages.share_embedPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        var embedButtons = [
            makeCancelButton(),
            {
                className: 'primary',
                name: Messages.share_linkCopy,
                iconClass: 'link',
                onClick: function () {
                    Feedback.send('SHARE_EMBED');
                    var v = opts.getEmbedValue();
                    Clipboard.copy(v, (err) => {
                        if (!err) { UI.log(Messages.shareSuccess); }
                    });
                },
                keys: [13]
        }];

        var embed = h('div.cp-share-modal', embedContent);
        var $embed = $(embed);

        $embed.find('#cp-embed-link-preview').val(opts.getEmbedValue());

        cb(void 0, {
            content: embed,
            buttons: embedButtons
        });
    };

    var getRightsHeader = function (common, opts) {
        var hashes = opts.hashes;
        var hash = hashes.editHash || hashes.viewHash;
        var origin = opts.origin;
        var pathname = opts.pathname;
        var parsed = Hash.parsePadUrl(pathname);
        var canPresent = ['code', 'slide'].indexOf(parsed.type) !== -1;
        var versionHash = hashes.viewHash && opts.versionHash;
        var isForm = parsed.type === "form"; // && opts.auditorHash;
        var canBAR = parsed.type !== 'drive' && !versionHash && !isForm;

        var labelEdit = Messages.share_linkEdit;
        var labelView = Messages.share_linkView;

        var auditor;
        if (isForm) {
            labelEdit = Messages.share_formEdit;
            labelView = Messages.share_formView;
            auditor = UI.createRadio('accessRights', 'cp-share-form', Messages.share_formAuditor, false, {
                mark: {tabindex:0},
            });
        }

        var burnAfterReading = (hashes.viewHash && canBAR) ?
                    UI.createRadio('accessRights', 'cp-share-bar', Messages.burnAfterReading_linkBurnAfterReading, false, {
                        mark: {tabindex:0},
                        label: {style: "display: none;"}
                    }) : undefined;
        var rights = h('div.msg.cp-inline-radio-group', [
            h('label',{ for: 'cp-share-editable-true' }, Messages.share_linkAccess),
            h('div.radio-group',[
            UI.createRadio('accessRights', 'cp-share-editable-false',
                            labelView, true, { mark: {tabindex:0} }),
            canPresent ? UI.createRadio('accessRights', 'cp-share-present',
                            Messages.share_linkPresent, false, { mark: {tabindex:1} }) : undefined,
            UI.createRadio('accessRights', 'cp-share-editable-true',
                            labelEdit, false, { mark: {tabindex:0} }),
            auditor]),
            burnAfterReading,

        ]);

        // Burn after reading
        // Check if we are an owner of this pad. If we are, we can show the burn after reading option.
        // When BAR is selected, display a red message indicating the consequence and add
        // the options to generate the BAR url
        opts.barAlert = h('div.alert.alert-danger.cp-alertify-bar-selected', {
            style: 'display: none;'
        }, Messages.burnAfterReading_warningLink);
        var channel = opts.channel = Hash.getSecrets('pad', hash, opts.password).channel;
        common.getPadMetadata({
            channel: channel
        }, function (obj) {
            if (!obj || obj.error) { return; }
            var priv = common.getMetadataMgr().getPrivateData();
            // Not an owner: don't display the burn after reading option
            if (!Array.isArray(obj.owners) || obj.owners.indexOf(priv.edPublic) === -1) {
                $(burnAfterReading).remove();
                return;
            }
            // When the burn after reading option is selected, transform the modal buttons
            $(burnAfterReading).css({
                display: 'flex'
            });
        });

        var $rights = $(rights);

        opts.saveValue = function () {
            var edit = Util.isChecked($rights.find('#cp-share-editable-true'));
            var present = Util.isChecked($rights.find('#cp-share-present'));
            common.setAttribute(['general', 'share'], {
                edit: edit,
                present: present
            });
        };
        opts.getLinkValue = function (initValue, cb) {
            if (opts.static) { return opts.static; }
            var val = initValue || {};
            var edit = val.edit !== undefined ? val.edit : Util.isChecked($rights.find('#cp-share-editable-true'));
            var embed = val.embed;
            var present = val.present !== undefined ? val.present : Util.isChecked($rights.find('#cp-share-present'));
            var burnAfterReading = Util.isChecked($rights.find('#cp-share-bar'));
            var formAuditor = Util.isChecked($rights.find('#cp-share-form'));
            if (versionHash) {
                edit = false;
                present = false;
                burnAfterReading = false;
            }
            if (burnAfterReading && !opts.burnAfterReadingUrl) {
                if (cb) { // Called from the contacts tab, "share" button
                    var barHref = origin + pathname + '#' + (hashes.viewHash || hashes.editHash);
                    return makeBurnAfterReadingUrl(common, barHref, channel, opts, function (url) {
                        cb(url);
                    });
                }
                return Messages.burnAfterReading_generateLink;
            }
            var hash = (!hashes.viewHash || (edit && hashes.editHash)) ? hashes.editHash
                                                                       : hashes.viewHash;
            if (formAuditor && opts.auditorHash) {
                hash = opts.auditorHash;
                if (opts.hasPassword) {
                    hash += '/p';
                }
            }
            var href = burnAfterReading ? opts.burnAfterReadingUrl
                                             : (origin + pathname + '#' + hash);
            var parsed = Hash.parsePadUrl(href);
            return origin + parsed.getUrl({embed: embed, present: present, versionHash: versionHash});
        };
        opts.getEmbedValue = function () {
            var url = opts.getLinkValue({
                embed: true
            });
            return '<iframe src="' + url + '"></iframe>';
        };
        // disable edit share options if you don't have edit rights
        if (versionHash) {
            $rights.find('#cp-share-editable-false').attr('checked', true);
            $rights.find('#cp-share-present').removeAttr('checked').attr('disabled', true);
            $rights.find('#cp-share-editable-true').removeAttr('checked').attr('disabled', true);
        } else if (!hashes.editHash) {
            if (opts.auditorHash) {
                $rights.find('#cp-share-editable-false').attr('checked', false).attr('disabled', true);
            } else {
                $rights.find('#cp-share-editable-false').attr('checked', true);
            }
            $rights.find('#cp-share-editable-true').removeAttr('checked').attr('disabled', true);
        } else if (!hashes.viewHash) {
            $rights.find('#cp-share-editable-false').removeAttr('checked').attr('disabled', true);
            $rights.find('#cp-share-present').removeAttr('checked').attr('disabled', true);
            $rights.find('#cp-share-editable-true').attr('checked', true);
        }
        if (isForm && !opts.auditorHash) {
            $rights.find('#cp-share-form').removeAttr('checked').attr('disabled', true);
        }

        var getLink = function () {
            return $rights.parent().find('#cp-share-link-preview');
        };
        var getEmbed = function () {
            return $rights.parent().find('#cp-embed-link-preview');
        };
        var getQR = function () {
            return $rights.parent().find('#cp-qr-target');
        };

        // update values for link and embed preview when radio btns change
        $rights.find('input[type="radio"]').on('change', function () {
            var link = opts.getLinkValue({
                embed: Util.isChecked($('.alertify').find('#cp-share-embed'))
            });

            getLink().val(link);
            // Hide or show the burn after reading alert
            if (Util.isChecked($rights.find('#cp-share-bar')) && !opts.burnAfterReadingUrl) {
                $('.cp-alertify-bar-selected').show();
                // Show burn after reading button
                $('.alertify').find('.cp-bar').show();
                $('.alertify').find('.cp-nobar').hide();
                return;
            }
            getEmbed().val(opts.getEmbedValue());

            var qr = getQRCode(opts.getLinkValue());
            getQR().html('').append(qr);

            // Hide burn after reading button
            $('.alertify').find('.cp-nobar').show();
            $('.alertify').find('.cp-bar').hide();
            $('.cp-alertify-bar-selected').hide();
        });

        // Set default values
        common.getAttribute(['general', 'share'], function (err, val) {
            val = val || {};
            if (versionHash) {
                $rights.find('#cp-share-editable-false').prop('checked', true);
            } else if (val.present && canPresent) {
                $rights.find('#cp-share-editable-false').prop('checked', false);
                $rights.find('#cp-share-editable-true').prop('checked', false);
                $rights.find('#cp-share-present').prop('checked', true);
            } else if ((val.edit === false && hashes.viewHash) || !hashes.editHash) {
                if (opts.auditorHash) {
                    $rights.find('#cp-share-editable-false').prop('checked', false);
                    $rights.find('#cp-share-form').prop('checked', true);
                } else {
                    $rights.find('#cp-share-editable-false').prop('checked', true);
                }
                $rights.find('#cp-share-editable-true').prop('checked', false);
                $rights.find('#cp-share-present').prop('checked', false);
            } else {
                $rights.find('#cp-share-editable-true').prop('checked', true);
                $rights.find('#cp-share-editable-false').prop('checked', false);
                $rights.find('#cp-share-present').prop('checked', false);
            }
            delete val.embed;
            if (!canPresent) {
                delete val.present;
            }
            getLink().val(opts.getLinkValue(val));
        });
        common.getMetadataMgr().onChange(function () {
            // "hashes" is only available is the secure "share" app
            var _hashes = common.getMetadataMgr().getPrivateData().hashes;
            const h = _hashes.editHash || _hashes.viewHash;
            const c = Hash.getSecrets('pad', h, opts.password).channel;
            if (channel !== c) { return; }
            if (!_hashes) { return; }
            hashes = _hashes;
            getLink().val(opts.getLinkValue());
        });

        return $rights;
    };

    Messages.share_QRCategory = "QR"; // NEXT

    // In the share modal, tabs need to share data between themselves.
    // To do so we're using "opts" to store data and functions
    Share.getShareModal = function (common, opts, cb) {
        cb = cb || function () {};
        opts = opts || {};
        opts.access = true; // Allow the use of the modal even if the pad is not stored

        var hashes = opts.hashes;
        if (!hashes || (!hashes.editHash && !hashes.viewHash && !opts.static)) { return cb("NO_HASHES"); }

        var teams = getEditableTeams(common, opts);
        opts.teams = teams;
        var hasFriends = opts.hasFriends = Object.keys(opts.friends || {}).length ||
                         Object.keys(teams).length;
        var metadataMgr = common.getMetadataMgr();
        var priv = metadataMgr.getPrivateData();

        // check if the pad is password protected
        var pathname = opts.pathname;
        var hash = hashes.editHash || hashes.viewHash;
        var href = pathname + '#' + hash;
        var parsedHref = Hash.parsePadUrl(href);
        opts.hasPassword = parsedHref.hashData.password;


        var $rights = opts.$rights = getRightsHeader(common, opts);
        var resetTab = function () {
            if (opts.static) { return; }
            $rights.show();
            $rights.find('label.cp-radio').show();
        };
        var onShowEmbed = function () {
            if (opts.static) { return; }
            $rights.find('#cp-share-bar').closest('label').hide();
            $rights.find('input[type="radio"]:enabled').first().prop('checked', 'checked');
            $rights.find('input[type="radio"]').trigger('change');
        };
        var onShowContacts = function () {
            if (opts.static) { return; }
            if (!hasFriends || priv.offline) {
                $rights.hide();
            }
        };
        if (opts.static) { $rights.hide(); }

        var pftSharingActive = Boolean(ApiConfig.postFiat);
        var contactsActive = !pftSharingActive && hasFriends && !priv.offline;
        var tabs = [pftSharingActive ? {
            getTab: getPostFiatTab,
            title: 'Post Fiat',
            icon: 'share',
            active: true,
            onHide: resetTab
        } : undefined, {
            getTab: getContactsTab,
            title: Messages.share_contactCategory,
            icon: "contacts",
            active: contactsActive,
            onShow: onShowContacts,
            onHide: resetTab
        }, {
            getTab: getLinkTab,
            title: Messages.share_linkCategory,
            icon: "link",
            active: !contactsActive && !pftSharingActive,
        }, window.CP_DEV_MODE ? { // NEXT enable for all
            getTab: getQRTab,
            title: Messages.share_QRCategory,
            icon: 'qr-code',
        } : undefined].filter(Boolean);
        if (!opts.static && ApiConfig.enableEmbedding && embeddableApps.includes(pathname)) {
            tabs.push({
                getTab: getEmbedTab,
                title: Messages.share_embedCategory,
                icon: "code",
                onShow: onShowEmbed,
                onHide: resetTab
            });
        }
        Modal.getModal(common, opts, tabs, function (err, modal) {
            // Hide the burn-after-reading option by default
            var $modal = $(modal);
            $modal.find('.cp-bar').hide();

            // Prepend the "rights" radio selection
            $modal.find('.alertify-tabs-titles').after($rights);

            // Add the versionHash warning if needed
            if (opts.versionHash) {
                $rights.after(h('div.alert.alert-warning', [
                    Icons.get('history'),
                    UI.setHTML(h('span'), Messages.share_versionHash)
                ]));
            }

            // callback
            cb(err, modal);
        });
    };

    var getFileContactsTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var common = Env.common;
        var friendsObject = opts.hasFriends ? createShareWithFriends(opts, null, opts.getLinkValue) : UIElements.noContactsMessage(common);
        var friendsList = friendsObject.content;

        var contactsContent = h('div.cp-share-modal');
        var $contactsContent = $(contactsContent);
        $contactsContent.append(friendsList);

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            $contactsContent.append(h('div.alert.alert-primary', [
                Icons.get('lock'),
                Messages.share_linkPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        var contactButtons = friendsObject.buttons;
        contactButtons.unshift(makeCancelButton());

        cb(void 0, {
            content: contactsContent,
            buttons: contactButtons
        });
    };

    var getFileLinkTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var linkContent = [
            UI.dialog.selectableArea(opts.getLinkValue(), {
                id: 'cp-share-link-preview', tabindex: 0, rows:2
            })
        ];

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            linkContent.push(h('div.alert.alert-primary', [
                Icons.get('lock'),
                Messages.share_linkPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        // warning about sharing links
        var localStore = window.cryptpadStore;
        var dismissButton = Icons.get('close');
        var shareLinkWarning = h('div.alert.alert-warning.dismissable',
            { style: 'display: none;' },
            [
                h('span.cp-inline-alert-text', Messages.share_linkWarning),
                dismissButton
            ]);
        linkContent.push(shareLinkWarning);

        localStore.get('hide-alert-shareLinkWarning', function (val) {
            if (val === '1') { return; }
            $(shareLinkWarning).css('display', 'flex');

            $(dismissButton).on('click', function () {
                localStore.put('hide-alert-shareLinkWarning', '1');
                $(shareLinkWarning).remove();
            });
        });

        var link = h('div.cp-share-modal', linkContent);
        var linkButtons = [
            makeCancelButton(),
            {
                className: 'primary',
                name: Messages.share_linkCopy,
                iconClass: 'link',
                onClick: function () {
                    var v = opts.getLinkValue();
                    Clipboard.copy(v, (err) => {
                        if (!err) { UI.log(Messages.shareSuccess); }
                    });
                },
                keys: [13]
            }
        ];

        cb(void 0, {
            content: link,
            buttons: linkButtons
        });
    };

    var getFileEmbedTab = function (Env, data, opts, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        var common = Env.common;
        var fileData = opts.fileData;

        var embed = h('div.cp-share-modal', [
            h('p', Messages.fileEmbedScript),
            UI.dialog.selectable(common.getMediatagScript()),
            h('p', Messages.fileEmbedTag),
            UI.dialog.selectable(common.getMediatagFromHref(fileData)),
        ]);

        // Show alert if the pad is password protected
        if (opts.hasPassword) {
            $(embed).append(h('div.alert.alert-primary', [
                Icons.get('lock'),
                Messages.share_linkPasswordAlert, h('br'),
                makeFaqLink(opts)
            ]));
        }

        var embedButtons = [{
            className: 'cancel',
            name: Messages.cancel,
            onClick: function () {},
            keys: [27]
        }, {
            className: 'primary',
            name: Messages.share_mediatagCopy,
            iconClass: 'link',
            onClick: function () {
                var v = common.getMediatagFromHref(opts.fileData);
                Clipboard.copy(v, (err) => {
                    if (!err) { UI.log(Messages.shareSuccess); }
                });
            },
            keys: [13]
        }];

        cb(void 0, {
            content: embed,
            buttons: embedButtons
        });
    };

    Share.getFileShareModal = function (common, opts, cb) {
        cb = cb || function () {};
        opts = opts || {};
        opts.access = true; // Allow the use of the modal even if the pad is not stored

        var hashes = opts.hashes;
        if (!hashes || !hashes.fileHash) { return; }

        var teams = getEditableTeams(common, opts);
        opts.teams = teams;
        var hasFriends = opts.hasFriends = Object.keys(opts.friends || {}).length ||
                         Object.keys(teams).length;

        // check if the pad is password protected
        var origin = opts.origin;
        var pathname = opts.pathname;
        var url = opts.url = origin + pathname + '#' + hashes.fileHash;
        var parsedHref = Hash.parsePadUrl(url);
        opts.hasPassword = parsedHref.hashData.password;
        opts.getLinkValue = function () { return url; };

        var tabs = [{
            getTab: getFileContactsTab,
            title: Messages.share_contactCategory,
            icon: "contacts",
            active: hasFriends,
        }, {
            getTab: getFileLinkTab,
            title: Messages.share_linkCategory,
            icon: "link",
            active: !hasFriends,
        }];

        // NEXT add QR code generation for files
        if (ApiConfig.enableEmbedding) {
            tabs.push({
                getTab: getFileEmbedTab,
                title: Messages.share_embedCategory,
                icon: "code",
            });
        }

        Modal.getModal(common, opts, tabs, cb);
    };

    return Share;
});
