// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

define([
    '/components/nthen/index.js',
    '/common/dom-ready.js',
    '/common/sframe-common-outer.js',
], function (nThen, DomReady, SFCommonO) {
    nThen(function (waitFor) {
        DomReady.onReady(waitFor());
    }).nThen(function (waitFor) {
        SFCommonO.initIframe(waitFor);
    }).nThen(function () {
        var addRpc = function (sframeChan, Cryptpad) {
            sframeChan.on('Q_DRIVE_USEROBJECT', function (data, cb) {
                Cryptpad.userObjectCommand(data, cb);
            });
            sframeChan.on('Q_DRIVE_RESTORE', function (data, cb) {
                Cryptpad.restoreDrive(data, cb);
            });
            sframeChan.on('Q_DRIVE_GETOBJECT', function (data, cb) {
                if (data && data.sharedFolder) {
                    Cryptpad.getSharedFolder({
                        id: data.sharedFolder
                    }, function (obj) {
                        cb(obj);
                    });
                    return;
                }
                Cryptpad.getUserObject(null, function (obj) {
                    cb(obj);
                });
            });
            sframeChan.on('EV_POSTFIAT_APP_READY', function () {
                var placeholder = document.querySelector('#placeholder');
                if (placeholder && typeof(placeholder.remove) === 'function') {
                    placeholder.remove();
                }
            });
            Cryptpad.onNetworkDisconnect.reg(function () {
                sframeChan.event('EV_NETWORK_DISCONNECT');
            });
            Cryptpad.onNetworkReconnect.reg(function () {
                sframeChan.event('EV_NETWORK_RECONNECT');
            });
            Cryptpad.drive.onLog.reg(function (msg) {
                sframeChan.event('EV_DRIVE_LOG', msg);
            });
            Cryptpad.drive.onChange.reg(function (data) {
                sframeChan.event('EV_DRIVE_CHANGE', data);
            });
            Cryptpad.drive.onRemove.reg(function (data) {
                sframeChan.event('EV_DRIVE_REMOVE', data);
            });
        };

        SFCommonO.start({
            requires: 'drive',
            cache: true,
            noHash: true,
            noRealtime: true,
            driveEvents: true,
            addRpc: addRpc,
            isDrive: true,
        });
    });
});
