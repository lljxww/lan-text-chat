# Manual Testing

## Scenario 1: Connect Server

1. Start the Rust chat server with WebSocket support.
2. Start the VS Code extension host.
3. Set `lanTextChat.serverUrl`.
4. Run `LAN Chat: Connect Server`.
5. Confirm the chat view shows `Connected`.

## Scenario 2: Two-Client Direct Chat

1. Start two extension hosts. From the repository root, run:

```powershell
.\scripts\start-dual-test.ps1
```

Or launch them manually. The important part is that `--extensionDevelopmentPath` points to `vscode-extension`, not the repository root:

```powershell
code --new-window --extensionDevelopmentPath .\vscode-extension --user-data-dir "$env:TEMP\lan-chat-a" .\vscode-extension
code --new-window --extensionDevelopmentPath .\vscode-extension --user-data-dir "$env:TEMP\lan-chat-b" .\vscode-extension
```

2. Configure client A as `Alice`.
3. Configure client B as `Bob`.
4. In A, click Bob in Online Users or run `LAN Chat: Send Direct Message`.
5. Send a message from A to B.
6. Confirm B receives the message.
7. Open the conversation on B.
8. Confirm A receives a read receipt and displays `read`.

## Scenario 3: Three-Person Group Chat

1. Start clients A, B, and C.
2. A creates `Backend Team`.
3. A invites B and C.
4. A sends a group message.
5. Confirm B and C receive it.
6. B opens the group and sends a read receipt.
7. Confirm A shows `read 1/2`.
8. C opens the group.
9. Confirm A shows `read 2/2`.

## Scenario 4: Server Disconnect

1. Connect the extension to the server.
2. Stop the Rust server.
3. Confirm the extension shows `Reconnecting` or `Error`.
4. Restart the server.
5. Confirm the extension reconnects automatically when `autoReconnect` is enabled.

## Scenario 5: Offline Mode

1. Enable `lanTextChat.offlineMode`.
2. Confirm the WebSocket disconnects and the UI shows `Offline`.
3. Try to send a message.
4. Confirm the extension warns that offline mode prevents sending.
5. Disable offline mode.
6. Confirm the extension connects again.

## Scenario 6: VS Code Restart

1. Send several direct and group messages.
2. Restart the extension host.
3. Confirm local history appears from cache.
4. Reconnect to the server.
5. Confirm users, groups, and conversations sync from WebSocket `hello-ack` or `server-sync`.

## Known Limits

- HTTP sync endpoints are optional. If the Rust server does not implement them, the extension continues using WebSocket state and local cache.
- Group mutations require server confirmation. The UI sends requests but does not treat local group cache as authoritative.
- The server currently stores users, groups, conversations, and messages in memory. Restarting the Rust process clears server-side state.
