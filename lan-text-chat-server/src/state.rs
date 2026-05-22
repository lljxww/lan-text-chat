use crate::models::{Conversation, ConversationType, Group, StoredMessage, User};
use crate::util::truncate_preview;
use axum::extract::ws::Message;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::RwLock;

pub type SharedState = Arc<RwLock<AppState>>;

#[derive(Debug, Default)]
pub struct AppState {
    pub clients: HashMap<String, ClientConnection>,
    pub users: HashMap<String, User>,
    pub groups: HashMap<String, Group>,
    pub conversations: HashMap<String, Conversation>,
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Clone)]
pub struct ClientConnection {
    pub sender: UnboundedSender<Message>,
}

pub fn groups_for_user(state: &AppState, user_id: &str) -> Vec<Group> {
    state
        .groups
        .values()
        .filter(|group| group.members.iter().any(|member| member.user_id == user_id))
        .cloned()
        .collect()
}

pub fn conversations_for_user(state: &AppState, user_id: &str) -> Vec<Conversation> {
    state
        .conversations
        .values()
        .filter_map(|conversation| match conversation.conversation_type {
            ConversationType::Direct => direct_conversation_for_user(state, conversation, user_id),
            ConversationType::Group => conversation
                .group_id
                .as_ref()
                .and_then(|group_id| state.groups.get(group_id))
                .is_some_and(|group| group.members.iter().any(|member| member.user_id == user_id))
                .then(|| conversation.clone()),
        })
        .collect()
}

pub fn upsert_direct_conversations(
    state: &mut AppState,
    from_user_id: &str,
    to_user_id: &str,
    from_username: &str,
    text: &str,
    timestamp: &str,
) {
    let preview = Some(truncate_preview(text));
    state.conversations.insert(
        direct_conversation_id(from_user_id, to_user_id),
        Conversation {
            id: direct_conversation_id(from_user_id, to_user_id),
            conversation_type: ConversationType::Direct,
            title: from_username.to_string(),
            target_user_id: Some(from_user_id.to_string()),
            group_id: None,
            unread_count: 0,
            updated_at: timestamp.to_string(),
            last_message_preview: preview,
        },
    );
}

pub fn upsert_group_conversation(
    state: &mut AppState,
    group: &Group,
    preview_text: Option<&str>,
    timestamp: &str,
) {
    state.conversations.insert(
        group.id.clone(),
        Conversation {
            id: group.id.clone(),
            conversation_type: ConversationType::Group,
            title: group.name.clone(),
            target_user_id: None,
            group_id: Some(group.id.clone()),
            unread_count: 0,
            updated_at: timestamp.to_string(),
            last_message_preview: preview_text.map(truncate_preview),
        },
    );
}

pub fn direct_conversation_id(a: &str, b: &str) -> String {
    if a <= b {
        format!("direct:{a}:{b}")
    } else {
        format!("direct:{b}:{a}")
    }
}

fn direct_conversation_for_user(
    state: &AppState,
    conversation: &Conversation,
    user_id: &str,
) -> Option<Conversation> {
    let (a, b) = direct_conversation_participants(&conversation.id)?;
    let other_user_id = if a == user_id {
        b
    } else if b == user_id {
        a
    } else {
        return None;
    };
    let mut visible = conversation.clone();
    visible.target_user_id = Some(other_user_id.clone());
    visible.title = state
        .users
        .get(&other_user_id)
        .map(|user| user.username.clone())
        .unwrap_or(other_user_id);
    Some(visible)
}

fn direct_conversation_participants(conversation_id: &str) -> Option<(String, String)> {
    let Some(rest) = conversation_id.strip_prefix("direct:") else {
        return None;
    };
    let mut parts = rest.split(':');
    let a = parts.next()?;
    let b = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some((a.to_string(), b.to_string()))
}

pub fn placeholder_user(user_id: &str) -> User {
    User {
        user_id: user_id.to_string(),
        username: user_id.to_string(),
        online: false,
        last_seen_at: None,
        ip_address: None,
    }
}
