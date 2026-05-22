# LAN Text Chat VS Code Extension

VS Code client for the Rust-backed LAN Text Chat system.

Project: [lljxww/lan-text-chat](https://github.com/lljxww/lan-text-chat)

The extension connects to one Rust chat server using WebSocket. It no longer opens a local listening port, discovers peers with UDP multicast, or sends messages directly to target IPs. The server owns routing, groups, online status, and read receipt broadcast.

## Security Notice

LAN Text Chat uses plain WebSocket (`ws://`) by default. Messages and metadata are clear text and are not encrypted or authenticated by this project. Use it only on trusted networks and do not send sensitive content unless you have added suitable protection such as VPN, SSH tunneling, or a TLS reverse proxy.

## Server

Start the Rust backend before connecting clients:

```powershell
cd lan-text-chat-server
cargo run -- 0.0.0.0:38991
```

Configure the extension with the server WebSocket URL:

```text
ws://127.0.0.1:38991/ws
```

The default is `ws://127.0.0.1:38991/ws`. If the server runs on another LAN machine, replace `127.0.0.1` with that machine's LAN IP address. Open inbound TCP port `38991` on the server machine's firewall. Other VS Code clients on the LAN only need outbound access to that server address and port.

## Settings

```json
{
  "lanTextChat.serverUrl": "ws://127.0.0.1:38991/ws",
  "lanTextChat.username": "",
  "lanTextChat.offlineMode": false,
  "lanTextChat.enableReadReceipts": true,
  "lanTextChat.enableNotifications": true,
  "lanTextChat.autoReconnect": true,
  "lanTextChat.reconnectIntervalMs": 3000,
  "lanTextChat.maxSavedMessages": 1000
}
```

`lanTextChat.username` may be left empty; the extension uses the operating system username. `lanTextChat.userId` may also be left empty; the extension creates a stable UUID in VS Code globalState.

`lanTextChat.maxSavedMessages` limits locally saved messages across all conversations. `lanTextChat.enableNotifications` controls whether incoming messages show VS Code notifications.

Deprecated peer-to-peer settings (`targetIps`, `port`, `serviceAddress`) are ignored by the new client.

## Commands

- `LAN Chat: Connect Server`
- `LAN Chat: Disconnect Server`
- `LAN Chat: Toggle Offline Mode`
- `LAN Chat: Send Direct Message`
- `LAN Chat: Create Group`
- `LAN Chat: Rename Group`
- `LAN Chat: Invite User to Group`
- `LAN Chat: Leave Group`
- `LAN Chat: Delete Group`
- `LAN Chat: Clear Local History`

## Build

```powershell
npm install
npm run compile
```

## Notes

The Webview is UI-only and communicates with the extension host through `postMessage`. It uses a nonce and a Content Security Policy. Messages are rendered with DOM text nodes rather than untrusted `innerHTML`.
