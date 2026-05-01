#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${POSTFIAT_ONION_STATE_DIR:-"$ROOT/.postfiat-onion"}"
TOOLS_DIR="$STATE_DIR/tools"
DATA_DIR="$STATE_DIR/tor-data"
TORRC="$STATE_DIR/torrc"
PID_FILE="$STATE_DIR/tor.pid"

HTTP_HOST="${POSTFIAT_ONION_HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${POSTFIAT_ONION_HTTP_PORT:-3200}"
HTTP_SAFE_PORT="${POSTFIAT_ONION_HTTP_SAFE_PORT:-3201}"
WS_PORT="${POSTFIAT_ONION_WS_PORT:-3203}"
SOCKS_HOST="${POSTFIAT_ONION_SOCKS_HOST:-127.0.0.1}"
SOCKS_PORT="${POSTFIAT_ONION_SOCKS_PORT:-19050}"
MAX_WORKERS="${POSTFIAT_ONION_MAX_WORKERS:-2}"
PFTL_RPC_URL="${POSTFIAT_PFTL_RPC_URL:-http://178.156.143.199:5005}"
PFTL_WSS_URL="${POSTFIAT_PFTL_WSS_URL:-ws://178.156.143.199:6005}"
PFTL_IPFS_GATEWAY="${POSTFIAT_IPFS_GATEWAY:-https://dweb.link/ipfs/}"

MAIN_DIR="$DATA_DIR/cryptpad-main"
SAFE_DIR="$DATA_DIR/cryptpad-safe"

usage() {
    cat <<'EOF'
Usage: scripts/postfiat-onion-dev.sh <command>

Commands:
  start       Start Tor, create onion services, and write config/config.js
  run         Start Tor, write config/config.js, compress assets, then run npm start
  dev         Start Tor, write config/config.js, then run npm run dev
  status      Print onion URLs and process state
  check       Fetch /api/config over Tor SOCKS
  stop        Stop the Tor process started by this script

Environment overrides:
  POSTFIAT_ONION_STATE_DIR       Runtime state directory, default ./.postfiat-onion
  TOR_BIN                        Path to tor. If omitted, uses system tor or a user-local apt extract.
  POSTFIAT_ONION_HTTP_PORT       Local CryptPad HTTP port, default 3200
  POSTFIAT_ONION_WS_PORT         Local CryptPad websocket port, default 3203
  POSTFIAT_ONION_SOCKS_PORT      Local Tor SOCKS port, default 19050
  POSTFIAT_ONION_COMPRESS        Set to 0 to skip static .gz/.br generation
  POSTFIAT_PFTL_RPC_URL          PFTL JSON-RPC URL for same-origin Task Node proxy
  POSTFIAT_PFTL_WSS_URL          PFTL websocket URL for future signing flows
  POSTFIAT_IPFS_GATEWAY          Preferred IPFS gateway for same-origin Task Node proxy
EOF
}

ensure_tor_bin() {
    if [ -n "${TOR_BIN:-}" ]; then
        printf '%s\n' "$TOR_BIN"
        return
    fi

    if command -v tor >/dev/null 2>&1; then
        command -v tor
        return
    fi

    local local_tor="$TOOLS_DIR/tor-root/usr/bin/tor"
    if [ -x "$local_tor" ]; then
        printf '%s\n' "$local_tor"
        return
    fi

    if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg-deb >/dev/null 2>&1; then
        echo "Tor is not installed and apt-get/dpkg-deb are unavailable. Set TOR_BIN to a tor binary." >&2
        exit 1
    fi

    mkdir -p "$TOOLS_DIR/tor-debs" "$TOOLS_DIR/tor-root"
    (
        cd "$TOOLS_DIR/tor-debs"
        apt-get download tor
    )
    local deb
    deb="$(ls -t "$TOOLS_DIR"/tor-debs/tor_*.deb | head -1)"
    dpkg-deb -x "$deb" "$TOOLS_DIR/tor-root"
    printf '%s\n' "$local_tor"
}

write_torrc() {
    mkdir -p "$DATA_DIR" "$MAIN_DIR" "$SAFE_DIR"
    chmod 700 "$DATA_DIR" "$MAIN_DIR" "$SAFE_DIR"

    cat > "$TORRC" <<EOF
DataDirectory $DATA_DIR
SocksPort $SOCKS_HOST:$SOCKS_PORT
Log notice file $DATA_DIR/notice.log
RunAsDaemon 0

HiddenServiceDir $MAIN_DIR/
HiddenServiceVersion 3
HiddenServicePort 80 $HTTP_HOST:$HTTP_PORT

HiddenServiceDir $SAFE_DIR/
HiddenServiceVersion 3
HiddenServicePort 80 $HTTP_HOST:$HTTP_PORT
EOF
}

tor_pid() {
    if [ -s "$PID_FILE" ]; then
        local pid
        pid="$(cat "$PID_FILE")"
        if kill -0 "$pid" >/dev/null 2>&1; then
            printf '%s\n' "$pid"
            return
        fi
    fi

    ps -eo pid=,args= | awk -v torrc="$TORRC" -v self="$$" '
        $1 != self && index($0, torrc) && $0 ~ /(^|\/)tor( |$)/ {
            print $1;
            exit;
        }
    '
}

start_tor() {
    local tor_bin
    tor_bin="$(ensure_tor_bin)"
    write_torrc

    local existing
    existing="$(tor_pid)"
    if [ -n "$existing" ]; then
        echo "$existing" > "$PID_FILE"
        return
    fi

    setsid -f "$tor_bin" -f "$TORRC" > "$DATA_DIR/stdout.log" 2>&1

    for _ in $(seq 1 50); do
        local pid
        pid="$(tor_pid)"
        if [ -n "$pid" ]; then
            echo "$pid" > "$PID_FILE"
            return
        fi
        sleep 0.2
    done

    echo "Tor did not stay running. See $DATA_DIR/stdout.log and $DATA_DIR/notice.log." >&2
    exit 1
}

wait_ready() {
    for _ in $(seq 1 120); do
        if [ -s "$MAIN_DIR/hostname" ] &&
           [ -s "$SAFE_DIR/hostname" ] &&
           rg -q 'Bootstrapped 100%' "$DATA_DIR/notice.log" 2>/dev/null; then
            return
        fi
        sleep 1
    done

    echo "Tor did not finish bootstrapping. See $DATA_DIR/notice.log." >&2
    exit 1
}

main_host() {
    cat "$MAIN_DIR/hostname"
}

safe_host() {
    cat "$SAFE_DIR/hostname"
}

write_config() {
    local main_origin safe_origin config_path backup_path
    main_origin="http://$(main_host)"
    safe_origin="http://$(safe_host)"
    config_path="$ROOT/config/config.js"

    mkdir -p "$ROOT/config"
    if [ -f "$config_path" ]; then
        backup_path="$config_path.onion-backup-$(date +%Y%m%d%H%M%S)"
        cp "$config_path" "$backup_path"
    fi

    cat > "$config_path" <<EOF
// Local onion development config. This file is gitignored.
const config = require('./config.example');

config.httpUnsafeOrigin = '$main_origin';
config.httpSafeOrigin = '$safe_origin';
config.httpAddress = '$HTTP_HOST';
config.httpPort = $HTTP_PORT;
config.httpSafePort = $HTTP_SAFE_PORT;
config.websocketPort = $WS_PORT;
config.maxWorkers = $MAX_WORKERS;
config.logToStdout = true;
config.logIP = false;
config.postFiat = config.postFiat || {};
config.postFiat.walletFirst = true;
config.postFiat.disableLegacyLogin = false;
config.postFiat.pftl = config.postFiat.pftl || {};
config.postFiat.pftl.networkId = 2025;
config.postFiat.pftl.rpcUrl = '$PFTL_RPC_URL';
config.postFiat.pftl.wssUrl = '$PFTL_WSS_URL';
config.postFiat.pftl.ipfsGateway = '$PFTL_IPFS_GATEWAY';
config.postFiat.nostr = config.postFiat.nostr || {};
config.postFiat.nostr.privateRelays = [
    'wss://relay.primal.net',
    'wss://nos.lol',
];

module.exports = config;
EOF
}

print_status() {
    local pid
    pid="$(tor_pid)"
    echo "state_dir=$STATE_DIR"
    echo "tor_pid=${pid:-stopped}"
    if [ -s "$MAIN_DIR/hostname" ]; then
        echo "main=http://$(main_host)/login/"
    fi
    if [ -s "$SAFE_DIR/hostname" ]; then
        echo "safe=http://$(safe_host)"
    fi
}

check_onion() {
    local main
    main="$(main_host)"
    curl --socks5-hostname "$SOCKS_HOST:$SOCKS_PORT" \
        --max-time 45 \
        --fail \
        --silent \
        --show-error \
        "http://$main/api/config" | head -40
}

stop_tor() {
    local pid
    pid="$(tor_pid)"
    if [ -z "$pid" ]; then
        echo "Tor is not running for $TORRC"
        return
    fi
    kill "$pid"
    rm -f "$PID_FILE"
}

cmd="${1:-}"
case "$cmd" in
    start)
        start_tor
        wait_ready
        write_config
        print_status
        ;;
    run)
        start_tor
        wait_ready
        write_config
        if [ "${POSTFIAT_ONION_COMPRESS:-1}" != "0" ]; then
            node "$ROOT/scripts/postfiat-compress-static.js" "$ROOT/www"
        fi
        print_status
        cd "$ROOT"
        exec npm run start
        ;;
    dev)
        start_tor
        wait_ready
        write_config
        print_status
        cd "$ROOT"
        exec npm run dev
        ;;
    status)
        print_status
        ;;
    check)
        check_onion
        ;;
    stop)
        stop_tor
        ;;
    -h|--help|help|'')
        usage
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac
