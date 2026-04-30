// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    buildLivePadSharePayload,
} from './live-pad-share.mjs';
import {
    buildNostrInboxDirectoryRecord,
    deriveNostrIdentityFromMnemonic,
    normalizeNostrPublicKeyHex,
    normalizeNostrRelayList,
    parseNostrInboxDirectoryRecord,
} from './nostr-identity.mjs';
import {
    buildPrivateShareGiftWrap,
    unwrapPrivateShareGiftWrap,
} from './nostr-private-share.mjs';
import {
    fetchGiftWrapsFromRelays,
    publishNostrEventToRelays,
} from './nostr-relay-client.mjs';

export const normalizePrivateShareRecipient = (record) => {
    const parsed = typeof record === 'string' ? (() => {
        const text = record.trim();
        if (text.startsWith('{')) {
            return JSON.parse(text);
        }
        return { publicKeyHex: text };
    })() : record;
    if (parsed?.kind) {
        return parseNostrInboxDirectoryRecord(parsed);
    }
    if (parsed?.walletAddress) {
        return buildNostrInboxDirectoryRecord(parsed);
    }
    return {
        publicKeyHex: normalizeNostrPublicKeyHex(parsed?.publicKeyHex || parsed?.pubkey),
        relays: normalizeNostrRelayList(parsed?.relays || []),
    };
};

const normalizeDirectoryRecord = (record) => {
    if (record?.kind) {
        return parseNostrInboxDirectoryRecord(record);
    }
    return normalizePrivateShareRecipient(record);
};

export const selectPrivateShareRelays = ({
    recipientDirectory,
    postFiatConfig,
    fallbackRelays,
} = {}) => {
    const recipientRelays = recipientDirectory?.relays || [];
    if (recipientRelays.length) {
        return normalizeNostrRelayList(recipientRelays);
    }
    const nostrConfig = postFiatConfig?.nostr || postFiatConfig || {};
    const configured = nostrConfig.privateRelays?.length ?
        nostrConfig.privateRelays : nostrConfig.relays;
    return normalizeNostrRelayList(configured?.length ? configured : fallbackRelays);
};

export const buildLivePadPrivateShare = async ({
    senderMnemonic,
    recipientDirectory,
    postFiatConfig,
    fallbackRelays,
    origin,
    href,
    title,
    mode,
    ownerWallet,
    createdAt,
    metadata,
    currentTime,
    rumorCreatedAt,
    sealCreatedAt,
    wrapCreatedAt,
    sealNonce,
    wrapNonce,
    wrapperPrivateKeyHex,
} = {}) => {
    const senderIdentity = await deriveNostrIdentityFromMnemonic(senderMnemonic, { origin });
    const directory = normalizeDirectoryRecord(recipientDirectory);
    const relays = selectPrivateShareRelays({
        recipientDirectory: directory,
        postFiatConfig,
        fallbackRelays,
    });
    const payload = buildLivePadSharePayload({
        href,
        title,
        mode,
        ownerWallet,
        sharedByWallet: senderIdentity.walletAddress,
        createdAt,
        metadata,
    });
    const wrapped = buildPrivateShareGiftWrap({
        senderPrivateKeyHex: senderIdentity.privateKeyHex,
        recipientPublicKeyHex: directory.publicKeyHex,
        recipientRelay: relays[0],
        payload,
        subject: title || payload.title,
        currentTime,
        rumorCreatedAt,
        sealCreatedAt,
        wrapCreatedAt,
        sealNonce,
        wrapNonce,
        wrapperPrivateKeyHex,
    });

    return {
        sender: {
            walletAddress: senderIdentity.walletAddress,
            publicKeyHex: senderIdentity.publicKeyHex,
        },
        recipient: directory,
        relays,
        payload,
        ...wrapped,
    };
};

export const buildOwnNostrInboxDirectory = async ({
    mnemonic,
    postFiatConfig,
    fallbackRelays,
    origin,
    createdAt,
} = {}) => {
    const identity = await deriveNostrIdentityFromMnemonic(mnemonic, { origin });
    const relays = selectPrivateShareRelays({
        recipientDirectory: { relays: [] },
        postFiatConfig,
        fallbackRelays,
    });
    return buildNostrInboxDirectoryRecord({
        walletAddress: identity.walletAddress,
        publicKeyHex: identity.publicKeyHex,
        relays,
        createdAt,
    });
};

export const publishLivePadPrivateShare = async (options = {}) => {
    const built = await buildLivePadPrivateShare(options);
    const publishResults = await publishNostrEventToRelays({
        relayUrls: built.relays,
        event: built.giftWrap,
        WebSocketImpl: options.WebSocketImpl,
        timeoutMs: options.timeoutMs,
    });
    return {
        ...built,
        publishResults,
    };
};

export const openLivePadPrivateShare = async ({
    recipientMnemonic,
    giftWrap,
    origin,
} = {}) => {
    const recipientIdentity = await deriveNostrIdentityFromMnemonic(recipientMnemonic, { origin });
    const opened = unwrapPrivateShareGiftWrap({
        giftWrap,
        recipientPrivateKeyHex: recipientIdentity.privateKeyHex,
    });
    return {
        recipient: {
            walletAddress: recipientIdentity.walletAddress,
            publicKeyHex: recipientIdentity.publicKeyHex,
        },
        ...opened,
        payload: opened.envelope.payload,
    };
};

export const fetchAndOpenLivePadPrivateShares = async ({
    recipientMnemonic,
    relayUrls,
    postFiatConfig,
    fallbackRelays,
    origin,
    WebSocketImpl,
    since,
    until,
    limit,
    timeoutMs,
} = {}) => {
    const recipientIdentity = await deriveNostrIdentityFromMnemonic(recipientMnemonic, { origin });
    const relays = normalizeNostrRelayList(
        relayUrls?.length ? relayUrls :
            postFiatConfig?.nostr?.privateRelays?.length ? postFiatConfig.nostr.privateRelays :
                postFiatConfig?.nostr?.relays?.length ? postFiatConfig.nostr.relays :
                    fallbackRelays
    );
    const inbox = await fetchGiftWrapsFromRelays({
        relayUrls: relays,
        recipientPublicKeyHex: recipientIdentity.publicKeyHex,
        WebSocketImpl,
        since,
        until,
        limit,
        timeoutMs,
    });
    const shares = [];
    const failures = [];
    inbox.events.forEach((giftWrap) => {
        try {
            const opened = unwrapPrivateShareGiftWrap({
                giftWrap,
                recipientPrivateKeyHex: recipientIdentity.privateKeyHex,
            });
            shares.push({
                ...opened,
                payload: opened.envelope.payload,
            });
        } catch (err) {
            failures.push({
                eventId: giftWrap?.id,
                error: err.message || String(err),
            });
        }
    });
    return {
        recipient: {
            walletAddress: recipientIdentity.walletAddress,
            publicKeyHex: recipientIdentity.publicKeyHex,
        },
        relays,
        inbox,
        shares,
        failures,
    };
};
