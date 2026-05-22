# LAN Text Chat

Project: [lljxww/lan-text-chat](https://github.com/lljxww/lan-text-chat)

This repository contains:

- `vscode-extension/`: VS Code chat client extension.
- `lan-text-chat-server/`: Rust chat server.

The current architecture is server-based. VS Code extensions do not listen on local LAN ports, do not use UDP discovery, and do not send directly to target IPs. Every extension instance connects to one Rust server over WebSocket; the server is responsible for message routing, group membership, online status, and read receipt fanout.

## Disclaimer

LAN Text Chat currently uses plain WebSocket (`ws://`) by default. Message content, usernames, group names, read receipts, and related metadata are transmitted in clear text with no encryption, authentication, or integrity protection provided by this project. Anyone with access to the network path may be able to inspect or tamper with traffic.

Use it only on trusted networks. Do not send passwords, tokens, private keys, production secrets, personal sensitive information, or other content that requires confidentiality. If you need protection, place the service behind a trusted VPN, SSH tunnel, or a properly configured TLS reverse proxy and evaluate the security model before use.

```text
VS Code extension A
        |
        | WebSocket
        |
Rust chat server
        |
        | WebSocket
        |
VS Code extension B / C / D
```

## Responsibilities

The Rust server is the source of truth for online users, direct and group message routing, group membership, and read receipt broadcast.

The VS Code extension handles UI, settings, WebSocket connection management, local cache files, notifications, and user actions. Webviews never connect to the Rust server directly; all server traffic goes through the extension host.

## Prerequisites

- Rust toolchain: install from <https://rustup.rs/>.
- Node.js and npm: required only when building or developing the VS Code extension.
- VS Code: required for running the extension client.
- All clients must be able to reach the same Rust server address and TCP port.

## Deploy the Rust Server

The Rust server is the only LAN service that needs an open inbound port. VS Code clients connect to it over WebSocket at `/ws`.

Start the Rust chat server first:

```powershell
git clone https://github.com/lljxww/lan-text-chat.git
cd lan-text-chat\lan-text-chat-server
cargo run -- 0.0.0.0:38991
```

On Linux or macOS:

```bash
cd /path/to/lan-text-chat/lan-text-chat-server
cargo run -- 0.0.0.0:38991
```

The listen address is optional. If omitted, the server defaults to `0.0.0.0:38991`:

```bash
cargo run
```

Use `0.0.0.0:38991` when other machines on the LAN need to connect. Use `127.0.0.1:38991` only for local single-machine testing.

The extension expects a WebSocket endpoint such as:

```text
ws://127.0.0.1:38991/ws
```

The default client setting is `ws://127.0.0.1:38991/ws`, which works when the Rust server runs on the same machine as VS Code. For other machines on the LAN, replace `127.0.0.1` with the LAN IP address of the machine running the Rust server. Keep the `/ws` path.

### Firewall and Port Rules

Open inbound TCP traffic to the server port on the server machine. The default port is `38991`.

Windows PowerShell, run as Administrator:

```powershell
New-NetFirewallRule -DisplayName "LAN Text Chat Server" -Direction Inbound -Protocol TCP -LocalPort 38991 -Action Allow
```

Ubuntu with UFW:

```bash
sudo ufw allow 38991/tcp
```

firewalld:

```bash
sudo firewall-cmd --add-port=38991/tcp --permanent
sudo firewall-cmd --reload
```

If the server runs behind a router and clients are on the same LAN, router port forwarding is not needed. If clients must connect from outside the LAN, expose the port carefully through VPN, SSH tunnel, reverse proxy, or router forwarding; plain `ws://` is not encrypted.

### Verify the Server Address

Find the server machine's LAN IP address:

Windows:

```powershell
ipconfig
```

Linux/macOS:

```bash
ip addr
```

Then configure every VS Code client with:

```text
ws://SERVER_LAN_IP:38991/ws
```

## Run the VS Code Extension

Then build the extension:

```powershell
cd lan-text-chat\vscode-extension
npm install
npm run compile
```

Open `vscode-extension/` in VS Code and press `F5`. Open the LAN Chat view, configure `serverUrl` and `username`, then use `LAN Chat: Connect Server`.

For two local extension-development clients, point `--extensionDevelopmentPath` at the extension folder, not the repository root:

```powershell
code --new-window --extensionDevelopmentPath .\vscode-extension --user-data-dir "$env:TEMP\lan-chat-a" .\vscode-extension
code --new-window --extensionDevelopmentPath .\vscode-extension --user-data-dir "$env:TEMP\lan-chat-b" .\vscode-extension
```

Or use the helper script:

```powershell
.\scripts\start-dual-test.ps1
```

## Configuration

Example settings:

```json
{
  "lanTextChat.serverUrl": "ws://127.0.0.1:38991/ws",
  "lanTextChat.username": "Alice",
  "lanTextChat.offlineMode": false,
  "lanTextChat.enableReadReceipts": true,
  "lanTextChat.enableNotifications": true,
  "lanTextChat.maxSavedMessages": 1000
}
```

Key settings:

- `lanTextChat.serverUrl`: Rust chat server WebSocket URL.
- `lanTextChat.username`: display name. If empty, the extension uses the operating system username.
- `lanTextChat.userId`: unique identity; if empty, the extension creates one in VS Code globalState.
- `lanTextChat.offlineMode`: disconnects from the server while keeping local history visible.
- `lanTextChat.enableReadReceipts`: sends read receipts when conversations are opened.
- `lanTextChat.enableNotifications`: shows VS Code notifications for incoming messages.
- `lanTextChat.autoReconnect`: reconnects after WebSocket disconnects.
- `lanTextChat.reconnectIntervalMs`: reconnect delay.
- `lanTextChat.maxSavedMessages`: maximum number of locally saved messages across all conversations. Default is `1000`.

You can edit these from the LAN Chat settings panel or directly in VS Code `settings.json`.

Deprecated settings from the old peer-to-peer model:

- `lanTextChat.targetIps`
- `lanTextChat.port`
- `lanTextChat.serviceAddress`

These settings are retained only for compatibility and are not used by the new client.

## Groups

Groups are managed by the Rust server. The extension can request group creation, rename, member invitation, leave, and delete operations, but the server response is authoritative. Cached `groups.json` is only for quick local display after VS Code restarts.

## Offline Mode

Offline mode closes the WebSocket, stops reconnect timers, and prevents sending new messages. Local messages, conversations, groups, and users remain visible from cache. Disabling offline mode reconnects to the server and attempts to sync state.

## Read Receipts

When read receipts are enabled, opening a conversation sends receipts for unread incoming messages. Direct messages show `read`; group messages show read counts such as `read 2/5` when the server broadcasts receipt events.

## Local Cache

The extension stores cache files under `context.globalStorageUri`, not in the workspace:

- `messages.json`
- `conversations.json`
- `groups.json`
- `users.json`

Writes use a temp file followed by rename. Corrupt message/conversation files are backed up and ignored. Legacy `history.json` is migrated where possible and renamed to `history.json.legacy.backup.json`.

The Rust server currently keeps state in memory. Restarting the server clears online state, groups, and server-side conversation state. VS Code clients keep their local cache and can reconnect after the server starts again.

## Troubleshooting

- Confirm the Rust chat server is running.
- Confirm `lanTextChat.serverUrl` uses the correct host, port, and WebSocket path.
- Check that firewalls allow inbound TCP traffic to the server port.
- Confirm clients are using the server machine's LAN IP, not `127.0.0.1`, unless the client runs on the same machine.
- If the server prints `address already in use`, choose another port or stop the process already using `38991`.
- Open the `LAN Text Chat` OutputChannel for WebSocket, protocol, and cache errors.

## Build and Package

```powershell
cd lan-text-chat\vscode-extension
npm install
npm run compile
npx vsce package --allow-missing-repository
```

See `TESTING.md` for manual test scenarios.
