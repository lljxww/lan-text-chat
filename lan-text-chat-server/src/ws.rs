use crate::models::{
    ClientMessage, ConversationType, Group, ReadByEntry, ServerMessage, StoredMessage, User,
};
use crate::state::{
    conversations_for_user, groups_for_user, placeholder_user, upsert_direct_conversations,
    upsert_group_conversation, AppState, ClientConnection, SharedState,
};
use crate::util::{now, uuid_like};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashSet;
use std::net::SocketAddr;
use tokio::sync::mpsc::{self, UnboundedSender};

pub async fn ws_handler(
    State(state): State<SharedState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, addr.ip().to_string()))
}

async fn handle_socket(socket: WebSocket, state: SharedState, ip_address: String) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut registered_user_id: Option<String> = None;
    while let Some(result) = receiver.next().await {
        let Ok(message) = result else {
            break;
        };
        let Message::Text(raw) = message else {
            continue;
        };
        let parsed = serde_json::from_str::<ClientMessage>(&raw);
        let client_message = match parsed {
            Ok(message) => message,
            Err(error) => {
                send_server_message(
                    &tx,
                    &ServerMessage::Error {
                        request_id: None,
                        code: "INVALID_JSON".to_string(),
                        message: format!("Invalid JSON message: {error}"),
                    },
                );
                continue;
            }
        };
        match client_message {
            ClientMessage::Hello {
                client_id,
                username,
                client_type,
                protocol_version,
                timestamp,
            } => {
                println!(
                    "hello from {username} ({client_id}) type={client_type} protocol={protocol_version} at {timestamp}"
                );
                registered_user_id = Some(client_id.clone());
                register_user(
                    &state,
                    client_id,
                    username,
                    Some(ip_address.clone()),
                    tx.clone(),
                )
                .await;
            }
            ClientMessage::DirectMessage {
                id,
                from_user_id,
                to_user_id,
                text,
                timestamp,
            } => {
                require_registered(&tx, &registered_user_id, None, || async {
                    route_direct_message(
                        &state,
                        &tx,
                        id,
                        from_user_id,
                        to_user_id,
                        text,
                        timestamp,
                    )
                    .await;
                })
                .await;
            }
            ClientMessage::GroupMessage {
                id,
                group_id,
                from_user_id,
                text,
                timestamp,
            } => {
                require_registered(&tx, &registered_user_id, None, || async {
                    route_group_message(&state, &tx, id, group_id, from_user_id, text, timestamp)
                        .await;
                })
                .await;
            }
            ClientMessage::CreateGroup {
                request_id,
                name,
                member_user_ids,
            } => {
                if let Some(owner_user_id) = registered_user_id.as_ref() {
                    create_group(
                        &state,
                        request_id,
                        owner_user_id.clone(),
                        name,
                        member_user_ids,
                    )
                    .await;
                } else {
                    send_not_registered(&tx, Some(request_id));
                }
            }
            ClientMessage::UpdateGroup {
                request_id,
                group_id,
                name,
                member_user_ids,
                add_member_user_ids,
                remove_member_user_ids,
            } => {
                update_group(
                    &state,
                    &tx,
                    request_id,
                    group_id,
                    name,
                    member_user_ids,
                    add_member_user_ids,
                    remove_member_user_ids,
                )
                .await;
            }
            ClientMessage::DeleteGroup {
                request_id,
                group_id,
            } => {
                delete_group(&state, &tx, request_id, group_id).await;
            }
            ClientMessage::JoinGroup {
                request_id,
                group_id,
            } => {
                if let Some(user_id) = registered_user_id.as_ref() {
                    update_group(
                        &state,
                        &tx,
                        request_id,
                        group_id,
                        None,
                        None,
                        Some(vec![user_id.clone()]),
                        None,
                    )
                    .await;
                } else {
                    send_not_registered(&tx, Some(request_id));
                }
            }
            ClientMessage::LeaveGroup {
                request_id,
                group_id,
            } => {
                if let Some(user_id) = registered_user_id.as_ref() {
                    update_group(
                        &state,
                        &tx,
                        request_id,
                        group_id,
                        None,
                        None,
                        None,
                        Some(vec![user_id.clone()]),
                    )
                    .await;
                } else {
                    send_not_registered(&tx, Some(request_id));
                }
            }
            ClientMessage::ReadReceipt {
                message_id,
                conversation_type,
                conversation_id,
                reader_user_id,
                reader_username,
                timestamp,
            } => {
                route_read_receipt(
                    &state,
                    message_id,
                    conversation_type,
                    conversation_id,
                    reader_user_id,
                    reader_username,
                    timestamp,
                )
                .await;
            }
            ClientMessage::Typing {
                conversation_type,
                conversation_id,
                from_user_id,
                timestamp,
            } => {
                let _ = (conversation_type, conversation_id, from_user_id, timestamp);
            }
            ClientMessage::Ping { timestamp } => {
                send_server_message(&tx, &ServerMessage::Pong { timestamp });
            }
        }
    }

    if let Some(user_id) = registered_user_id {
        mark_user_offline(&state, user_id).await;
    }
    writer.abort();
}

async fn require_registered<F, Fut>(
    tx: &UnboundedSender<Message>,
    user_id: &Option<String>,
    request_id: Option<String>,
    action: F,
) where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    if user_id.is_some() {
        action().await;
    } else {
        send_not_registered(tx, request_id);
    }
}

async fn register_user(
    state: &SharedState,
    user_id: String,
    username: String,
    ip_address: Option<String>,
    sender: UnboundedSender<Message>,
) {
    let user = User {
        user_id: user_id.clone(),
        username,
        online: true,
        last_seen_at: Some(now()),
        ip_address,
    };
    {
        let mut state = state.write().await;
        state
            .clients
            .insert(user_id.clone(), ClientConnection { sender });
        state.users.insert(user_id.clone(), user.clone());
        let ack = ServerMessage::HelloAck {
            client_id: user_id.clone(),
            server_time: now(),
            online_users: state
                .users
                .values()
                .filter(|user| user.online)
                .cloned()
                .collect(),
            groups: groups_for_user(&state, &user_id),
            conversations: conversations_for_user(&state, &user_id),
        };
        send_to_user_locked(&state, &user_id, &ack);
    }
    broadcast(state, &ServerMessage::UserOnline { user }).await;
}

async fn mark_user_offline(state: &SharedState, user_id: String) {
    let last_seen_at = now();
    {
        let mut state = state.write().await;
        state.clients.remove(&user_id);
        if let Some(user) = state.users.get_mut(&user_id) {
            user.online = false;
            user.last_seen_at = Some(last_seen_at.clone());
        }
    }
    broadcast(
        state,
        &ServerMessage::UserOffline {
            user_id,
            last_seen_at,
        },
    )
    .await;
}

async fn route_direct_message(
    state: &SharedState,
    tx: &UnboundedSender<Message>,
    id: String,
    from_user_id: String,
    to_user_id: String,
    text: String,
    timestamp: String,
) {
    if from_user_id == to_user_id {
        send_server_message(
            tx,
            &ServerMessage::Error {
                request_id: None,
                code: "CANNOT_MESSAGE_SELF".to_string(),
                message: "Cannot send a direct message to yourself".to_string(),
            },
        );
        return;
    }

    let (from_username, packet) = {
        let mut state = state.write().await;
        let from_username = state
            .users
            .get(&from_user_id)
            .map(|user| user.username.clone())
            .unwrap_or_else(|| from_user_id.clone());
        let packet = ServerMessage::DirectMessage {
            id: id.clone(),
            from_user_id: from_user_id.clone(),
            from_username: from_username.clone(),
            to_user_id: to_user_id.clone(),
            text: text.clone(),
            timestamp: timestamp.clone(),
        };
        state.messages.push(StoredMessage {
            id,
            from_user_id: from_user_id.clone(),
            to_user_id: Some(to_user_id.clone()),
            read_by: Vec::new(),
        });
        upsert_direct_conversations(
            &mut state,
            &from_user_id,
            &to_user_id,
            &from_username,
            &text,
            &timestamp,
        );
        (from_username, packet)
    };
    let _ = from_username;
    let _ = from_user_id;
    send_to_users(state, &[to_user_id], &packet).await;
}

async fn route_group_message(
    state: &SharedState,
    tx: &UnboundedSender<Message>,
    id: String,
    group_id: String,
    from_user_id: String,
    text: String,
    timestamp: String,
) {
    let maybe_packet_and_members = {
        let mut state = state.write().await;
        let Some(group) = state.groups.get(&group_id).cloned() else {
            send_server_message(
                tx,
                &ServerMessage::Error {
                    request_id: None,
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            );
            return;
        };
        if !group
            .members
            .iter()
            .any(|member| member.user_id == from_user_id)
        {
            send_server_message(
                tx,
                &ServerMessage::Error {
                    request_id: None,
                    code: "NOT_GROUP_MEMBER".to_string(),
                    message: "User is not a group member".to_string(),
                },
            );
            return;
        }
        let from_username = state
            .users
            .get(&from_user_id)
            .map(|user| user.username.clone())
            .unwrap_or_else(|| from_user_id.clone());
        let packet = ServerMessage::GroupMessage {
            id: id.clone(),
            group_id: group_id.clone(),
            group_name: group.name.clone(),
            from_user_id: from_user_id.clone(),
            from_username: from_username.clone(),
            text: text.clone(),
            timestamp: timestamp.clone(),
        };
        state.messages.push(StoredMessage {
            id,
            from_user_id,
            to_user_id: None,
            read_by: Vec::new(),
        });
        upsert_group_conversation(&mut state, &group, Some(&text), &timestamp);
        let members = group
            .members
            .iter()
            .map(|member| member.user_id.clone())
            .collect::<Vec<_>>();
        (packet, members)
    };
    send_to_users(
        state,
        &maybe_packet_and_members.1,
        &maybe_packet_and_members.0,
    )
    .await;
}

async fn create_group(
    state: &SharedState,
    request_id: String,
    owner_user_id: String,
    name: String,
    member_user_ids: Vec<String>,
) {
    let (group, members) = {
        let mut state = state.write().await;
        let mut ids = member_user_ids;
        ids.push(owner_user_id.clone());
        ids.sort();
        ids.dedup();
        let members = ids
            .iter()
            .map(|id| {
                state
                    .users
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| placeholder_user(id))
            })
            .collect::<Vec<_>>();
        let group = Group {
            id: format!("group-{}", uuid_like()),
            name,
            owner_user_id: Some(owner_user_id),
            members: members.clone(),
            created_at: now(),
            updated_at: now(),
        };
        state.groups.insert(group.id.clone(), group.clone());
        upsert_group_conversation(&mut state, &group, None, &group.updated_at);
        let member_ids = members
            .iter()
            .map(|member| member.user_id.clone())
            .collect::<Vec<_>>();
        (group, member_ids)
    };
    send_to_users(
        state,
        &members,
        &ServerMessage::GroupCreated { request_id, group },
    )
    .await;
}

async fn update_group(
    state: &SharedState,
    tx: &UnboundedSender<Message>,
    request_id: String,
    group_id: String,
    name: Option<String>,
    member_user_ids: Option<Vec<String>>,
    add_member_user_ids: Option<Vec<String>>,
    remove_member_user_ids: Option<Vec<String>>,
) {
    let result = {
        let mut state = state.write().await;
        let Some(existing_group) = state.groups.get(&group_id).cloned() else {
            send_server_message(
                tx,
                &ServerMessage::Error {
                    request_id: Some(request_id),
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            );
            return;
        };

        let mut member_ids = if let Some(ids) = member_user_ids {
            ids
        } else {
            existing_group
                .members
                .iter()
                .map(|member| member.user_id.clone())
                .collect::<Vec<_>>()
        };
        if let Some(adds) = add_member_user_ids {
            member_ids.extend(adds);
        }
        if let Some(removes) = remove_member_user_ids {
            let remove_set = removes.into_iter().collect::<HashSet<_>>();
            member_ids.retain(|id| !remove_set.contains(id));
        }
        if let Some(owner) = existing_group.owner_user_id.as_ref() {
            member_ids.push(owner.clone());
        }
        member_ids.sort();
        member_ids.dedup();
        let members = member_ids
            .iter()
            .map(|id| {
                state
                    .users
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| placeholder_user(id))
            })
            .collect::<Vec<_>>();
        let group = Group {
            id: existing_group.id,
            name: name.unwrap_or(existing_group.name),
            owner_user_id: existing_group.owner_user_id,
            members,
            created_at: existing_group.created_at,
            updated_at: now(),
        };
        state.groups.insert(group.id.clone(), group.clone());
        upsert_group_conversation(&mut state, &group, None, &group.updated_at);
        let ids = group
            .members
            .iter()
            .map(|member| member.user_id.clone())
            .collect::<Vec<_>>();
        (group, ids)
    };
    send_to_users(
        state,
        &result.1,
        &ServerMessage::GroupUpdated {
            request_id,
            group: result.0,
        },
    )
    .await;
}

async fn delete_group(
    state: &SharedState,
    tx: &UnboundedSender<Message>,
    request_id: String,
    group_id: String,
) {
    let members = {
        let mut state = state.write().await;
        let Some(group) = state.groups.remove(&group_id) else {
            send_server_message(
                tx,
                &ServerMessage::Error {
                    request_id: Some(request_id),
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            );
            return;
        };
        state.conversations.remove(&group_id);
        group
            .members
            .iter()
            .map(|member| member.user_id.clone())
            .collect::<Vec<_>>()
    };
    send_to_users(
        state,
        &members,
        &ServerMessage::GroupDeleted {
            request_id,
            group_id,
        },
    )
    .await;
}

async fn route_read_receipt(
    state: &SharedState,
    message_id: String,
    conversation_type: ConversationType,
    conversation_id: String,
    reader_user_id: String,
    reader_username: String,
    timestamp: String,
) {
    let recipients = {
        let mut state = state.write().await;
        if let Some(message) = state
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            if !message
                .read_by
                .iter()
                .any(|entry| entry.user_id == reader_user_id)
            {
                message.read_by.push(ReadByEntry {
                    user_id: reader_user_id.clone(),
                    username: reader_username.clone(),
                    timestamp: timestamp.clone(),
                });
            }
        }
        match conversation_type {
            ConversationType::Direct => state
                .messages
                .iter()
                .find(|message| message.id == message_id)
                .map(|message| {
                    vec![
                        message.from_user_id.clone(),
                        message.to_user_id.clone().unwrap_or_default(),
                    ]
                })
                .unwrap_or_else(|| vec![reader_user_id.clone()]),
            ConversationType::Group => state
                .groups
                .get(&conversation_id)
                .map(|group| {
                    group
                        .members
                        .iter()
                        .map(|member| member.user_id.clone())
                        .collect()
                })
                .unwrap_or_else(|| vec![reader_user_id.clone()]),
        }
    };
    send_to_users(
        state,
        &recipients,
        &ServerMessage::ReadReceipt {
            message_id,
            conversation_type,
            conversation_id,
            reader_user_id,
            reader_username,
            timestamp,
        },
    )
    .await;
}

async fn broadcast(state: &SharedState, message: &ServerMessage) {
    let user_ids = {
        let state = state.read().await;
        state.clients.keys().cloned().collect::<Vec<_>>()
    };
    send_to_users(state, &user_ids, message).await;
}

async fn send_to_users(state: &SharedState, user_ids: &[String], message: &ServerMessage) {
    let state = state.read().await;
    let mut seen = HashSet::new();
    for user_id in user_ids {
        if seen.insert(user_id.clone()) {
            send_to_user_locked(&state, user_id, message);
        }
    }
}

fn send_to_user_locked(state: &AppState, user_id: &str, message: &ServerMessage) {
    if let Some(client) = state.clients.get(user_id) {
        send_server_message(&client.sender, message);
    }
}

fn send_server_message(tx: &UnboundedSender<Message>, message: &ServerMessage) {
    match serde_json::to_string(message) {
        Ok(raw) => {
            let _ = tx.send(Message::Text(raw));
        }
        Err(error) => eprintln!("Failed to serialize server message: {error}"),
    }
}

fn send_not_registered(tx: &UnboundedSender<Message>, request_id: Option<String>) {
    send_server_message(
        tx,
        &ServerMessage::Error {
            request_id,
            code: "NOT_REGISTERED".to_string(),
            message: "Send hello before other messages".to_string(),
        },
    );
}
