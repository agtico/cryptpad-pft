// SPDX-FileCopyrightText: 2026 Post Fiat contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    normalizeNostrPublicKeyHex,
    normalizeNostrRelayUrl,
} from './nostr-identity.mjs';
import {
    NOSTR_KIND_GIFT_WRAP,
    verifyNostrEvent,
} from './nostr-private-share.mjs';

export const DEFAULT_RELAY_TIMEOUT_MS = 10000;
export const DEFAULT_INBOX_LIMIT = 100;

const normalizeTimeout = (timeoutMs) => {
    const parsed = Number.parseInt(String(timeoutMs || DEFAULT_RELAY_TIMEOUT_MS), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('INVALID_RELAY_TIMEOUT');
    }
    return parsed;
};

const normalizeSubscriptionId = (subscriptionId) => {
    const normalized = String(subscriptionId || `pft-${Date.now().toString(16)}`).trim();
    if (!normalized || normalized.length > 64) {
        throw new Error('INVALID_NOSTR_SUBSCRIPTION_ID');
    }
    return normalized;
};

const normalizeUnixTimestamp = (value) => {
    if (typeof value === 'undefined' || value === null || value === '') { return; }
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('INVALID_NOSTR_FILTER_TIMESTAMP');
    }
    return parsed;
};

const normalizeLimit = (limit) => {
    const parsed = Number.parseInt(String(limit || DEFAULT_INBOX_LIMIT), 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) {
        throw new Error('INVALID_NOSTR_FILTER_LIMIT');
    }
    return parsed;
};

const getWebSocketImpl = (WebSocketImpl) => {
    const Impl = WebSocketImpl || globalThis.WebSocket;
    if (typeof Impl !== 'function') {
        throw new Error('WEBSOCKET_UNAVAILABLE');
    }
    return Impl;
};

const parseRelayMessage = (data) => {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
        throw new Error('INVALID_NOSTR_RELAY_MESSAGE');
    }
    return parsed;
};

export const buildRelayEventMessage = (event) => ['EVENT', event];

export const buildRelayCloseMessage = (subscriptionId) => [
    'CLOSE',
    normalizeSubscriptionId(subscriptionId),
];

export const buildRelayReqMessage = ({ subscriptionId, filters } = {}) => [
    'REQ',
    normalizeSubscriptionId(subscriptionId),
    ...(Array.isArray(filters) ? filters : [filters]),
];

export const fetchNostrEventsFromRelay = ({
    relayUrl,
    filters,
    WebSocketImpl,
    subscriptionId,
    timeoutMs,
} = {}) => new Promise((resolve, reject) => {
    const url = normalizeNostrRelayUrl(relayUrl);
    const subId = normalizeSubscriptionId(subscriptionId);
    const normalizedFilters = Array.isArray(filters) ? filters : [filters];
    if (!normalizedFilters.length || normalizedFilters.some((filter) =>
        !filter || typeof filter !== 'object')) {
        reject(new Error('INVALID_NOSTR_FILTERS'));
        return;
    }
    const Socket = getWebSocketImpl(WebSocketImpl);
    const socket = new Socket(url);
    const events = [];
    let settled = false;
    let timer;

    function closeSocket() {
        try {
            socket.send(JSON.stringify(buildRelayCloseMessage(subId)));
        } catch (err) {}
        try {
            socket.close();
        } catch (err) {}
    }
    function finish(err, value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        closeSocket();
        if (err) {
            reject(err);
        } else {
            resolve(value);
        }
    }
    timer = setTimeout(() => {
        finish(new Error('NOSTR_RELAY_FETCH_TIMEOUT'));
    }, normalizeTimeout(timeoutMs));

    socket.onerror = () => finish(new Error('NOSTR_RELAY_CONNECTION_ERROR'));
    socket.onopen = () => {
        socket.send(JSON.stringify(buildRelayReqMessage({
            subscriptionId: subId,
            filters: normalizedFilters,
        })));
    };
    socket.onmessage = (message) => {
        let data;
        try {
            data = parseRelayMessage(message.data);
        } catch (err) {
            finish(err);
            return;
        }
        if (data[0] === 'EVENT' && data[1] === subId) {
            const event = data[2];
            if (event && verifyNostrEvent(event)) {
                events.push(event);
            }
            return;
        }
        if (data[0] === 'EOSE' && data[1] === subId) {
            finish(null, {
                relayUrl: url,
                events,
            });
        }
    };
});

export const fetchNostrEventsFromRelays = async ({
    relayUrls,
    filters,
    WebSocketImpl,
    subscriptionId,
    timeoutMs,
} = {}) => {
    const urls = Array.from(new Set((relayUrls || []).map(normalizeNostrRelayUrl)));
    if (!urls.length) {
        throw new Error('MISSING_NOSTR_RELAYS');
    }
    const results = await Promise.all(urls.map(async (relayUrl) => {
        try {
            return await fetchNostrEventsFromRelay({
                relayUrl,
                filters,
                WebSocketImpl,
                subscriptionId,
                timeoutMs,
            });
        } catch (err) {
            return {
                relayUrl,
                events: [],
                error: err.message || String(err),
            };
        }
    }));
    const seen = new Set();
    const events = [];
    results.forEach((result) => {
        result.events.forEach((event) => {
            if (!seen.has(event.id)) {
                seen.add(event.id);
                events.push(event);
            }
        });
    });
    return {
        results,
        events,
    };
};

export const buildGiftWrapInboxFilter = ({
    recipientPublicKeyHex,
    since,
    until,
    limit,
} = {}) => {
    const filter = {
        kinds: [NOSTR_KIND_GIFT_WRAP],
        '#p': [normalizeNostrPublicKeyHex(recipientPublicKeyHex)],
        limit: normalizeLimit(limit),
    };
    const normalizedSince = normalizeUnixTimestamp(since);
    const normalizedUntil = normalizeUnixTimestamp(until);
    if (typeof normalizedSince === 'number') { filter.since = normalizedSince; }
    if (typeof normalizedUntil === 'number') { filter.until = normalizedUntil; }
    return filter;
};

export const publishNostrEventToRelay = ({
    relayUrl,
    event,
    WebSocketImpl,
    timeoutMs,
} = {}) => new Promise((resolve, reject) => {
    const url = normalizeNostrRelayUrl(relayUrl);
    if (!event || !event.id || !verifyNostrEvent(event)) {
        reject(new Error('INVALID_NOSTR_EVENT'));
        return;
    }
    const Socket = getWebSocketImpl(WebSocketImpl);
    const socket = new Socket(url);
    let settled = false;
    let timer;

    function closeSocket() {
        try {
            socket.close();
        } catch (err) {}
    }
    function finish(err, value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        closeSocket();
        if (err) {
            reject(err);
        } else {
            resolve(value);
        }
    }
    timer = setTimeout(() => {
        finish(new Error('NOSTR_RELAY_PUBLISH_TIMEOUT'));
    }, normalizeTimeout(timeoutMs));

    socket.onerror = () => finish(new Error('NOSTR_RELAY_CONNECTION_ERROR'));
    socket.onopen = () => {
        socket.send(JSON.stringify(buildRelayEventMessage(event)));
    };
    socket.onmessage = (message) => {
        let data;
        try {
            data = parseRelayMessage(message.data);
        } catch (err) {
            finish(err);
            return;
        }
        if (data[0] !== 'OK' || data[1] !== event.id) { return; }
        if (data[2] === true) {
            finish(null, {
                relayUrl: url,
                eventId: event.id,
                accepted: true,
                message: String(data[3] || ''),
            });
        } else {
            finish(new Error(String(data[3] || 'NOSTR_RELAY_REJECTED_EVENT')));
        }
    };
});

export const publishNostrEventToRelays = async ({
    relayUrls,
    event,
    WebSocketImpl,
    timeoutMs,
} = {}) => {
    const urls = Array.from(new Set((relayUrls || []).map(normalizeNostrRelayUrl)));
    if (!urls.length) {
        throw new Error('MISSING_NOSTR_RELAYS');
    }
    return Promise.all(urls.map(async (relayUrl) => {
        try {
            return await publishNostrEventToRelay({
                relayUrl,
                event,
                WebSocketImpl,
                timeoutMs,
            });
        } catch (err) {
            return {
                relayUrl,
                eventId: event?.id,
                accepted: false,
                message: err.message || String(err),
            };
        }
    }));
};

export const fetchGiftWrapsFromRelay = ({
    relayUrl,
    recipientPublicKeyHex,
    WebSocketImpl,
    subscriptionId,
    since,
    until,
    limit,
    timeoutMs,
} = {}) => {
    const url = normalizeNostrRelayUrl(relayUrl);
    const filter = buildGiftWrapInboxFilter({
        recipientPublicKeyHex,
        since,
        until,
        limit,
    });
    return fetchNostrEventsFromRelay({
        relayUrl: url,
        filters: [filter],
        WebSocketImpl,
        subscriptionId,
        timeoutMs,
    }).then((result) => ({
        ...result,
        events: result.events.filter((event) => event.kind === NOSTR_KIND_GIFT_WRAP),
    }));
};

export const fetchGiftWrapsFromRelays = async ({
    relayUrls,
    recipientPublicKeyHex,
    WebSocketImpl,
    since,
    until,
    limit,
    timeoutMs,
} = {}) => {
    const urls = Array.from(new Set((relayUrls || []).map(normalizeNostrRelayUrl)));
    if (!urls.length) {
        throw new Error('MISSING_NOSTR_RELAYS');
    }
    const result = await fetchNostrEventsFromRelays({
        relayUrls: urls,
        filters: [buildGiftWrapInboxFilter({
            recipientPublicKeyHex,
            since,
            until,
            limit,
        })],
        WebSocketImpl,
        timeoutMs,
    });
    return {
        results: result.results.map((relayResult) => ({
            ...relayResult,
            events: relayResult.events.filter((event) => event.kind === NOSTR_KIND_GIFT_WRAP),
        })),
        events: result.events.filter((event) => event.kind === NOSTR_KIND_GIFT_WRAP),
    };
};
