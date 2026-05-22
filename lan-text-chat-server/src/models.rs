use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub online: bool,
    #[serde(rename = "lastSeenAt", skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
    #[serde(rename = "ipAddress", skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(rename = "ownerUserId", skip_serializing_if = "Option::is_none")]
    pub owner_user_id: Option<String>,
    pub members: Vec<User>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    #[serde(rename = "type")]
    pub conversation_type: ConversationType,
    pub title: String,
    #[serde(rename = "targetUserId", skip_serializing_if = "Option::is_none")]
    pub target_user_id: Option<String>,
    #[serde(rename = "groupId", skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(rename = "unreadCount")]
    pub unread_count: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "lastMessagePreview", skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConversationType {
    Direct,
    Group,
}

#[derive(Debug, Clone)]
pub struct StoredMessage {
    pub id: String,
    pub from_user_id: String,
    pub to_user_id: Option<String>,
    pub read_by: Vec<ReadByEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadByEntry {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(rename = "clientId")]
        client_id: String,
        username: String,
        #[serde(rename = "clientType")]
        client_type: String,
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        timestamp: String,
    },
    #[serde(rename = "direct-message")]
    DirectMessage {
        id: String,
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        #[serde(rename = "toUserId")]
        to_user_id: String,
        text: String,
        timestamp: String,
    },
    #[serde(rename = "group-message")]
    GroupMessage {
        id: String,
        #[serde(rename = "groupId")]
        group_id: String,
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        text: String,
        timestamp: String,
    },
    #[serde(rename = "create-group")]
    CreateGroup {
        #[serde(rename = "requestId")]
        request_id: String,
        name: String,
        #[serde(rename = "memberUserIds")]
        member_user_ids: Vec<String>,
    },
    #[serde(rename = "update-group")]
    UpdateGroup {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "groupId")]
        group_id: String,
        name: Option<String>,
        #[serde(rename = "memberUserIds")]
        member_user_ids: Option<Vec<String>>,
        #[serde(rename = "addMemberUserIds")]
        add_member_user_ids: Option<Vec<String>>,
        #[serde(rename = "removeMemberUserIds")]
        remove_member_user_ids: Option<Vec<String>>,
    },
    #[serde(rename = "delete-group")]
    DeleteGroup {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "groupId")]
        group_id: String,
    },
    #[serde(rename = "join-group")]
    JoinGroup {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "groupId")]
        group_id: String,
    },
    #[serde(rename = "leave-group")]
    LeaveGroup {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "groupId")]
        group_id: String,
    },
    #[serde(rename = "read-receipt")]
    ReadReceipt {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "conversationType")]
        conversation_type: ConversationType,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "readerUserId")]
        reader_user_id: String,
        #[serde(rename = "readerUsername")]
        reader_username: String,
        timestamp: String,
    },
    #[serde(rename = "typing")]
    Typing {
        #[serde(rename = "conversationType")]
        conversation_type: ConversationType,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        timestamp: String,
    },
    #[serde(rename = "ping")]
    Ping { timestamp: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "hello-ack")]
    HelloAck {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "serverTime")]
        server_time: String,
        #[serde(rename = "onlineUsers")]
        online_users: Vec<User>,
        groups: Vec<Group>,
        conversations: Vec<Conversation>,
    },
    #[serde(rename = "direct-message")]
    DirectMessage {
        id: String,
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        #[serde(rename = "fromUsername")]
        from_username: String,
        #[serde(rename = "toUserId")]
        to_user_id: String,
        text: String,
        timestamp: String,
    },
    #[serde(rename = "group-message")]
    GroupMessage {
        id: String,
        #[serde(rename = "groupId")]
        group_id: String,
        #[serde(rename = "groupName")]
        group_name: String,
        #[serde(rename = "fromUserId")]
        from_user_id: String,
        #[serde(rename = "fromUsername")]
        from_username: String,
        text: String,
        timestamp: String,
    },
    #[serde(rename = "group-created")]
    GroupCreated {
        #[serde(rename = "requestId")]
        request_id: String,
        group: Group,
    },
    #[serde(rename = "group-updated")]
    GroupUpdated {
        #[serde(rename = "requestId")]
        request_id: String,
        group: Group,
    },
    #[serde(rename = "group-deleted")]
    GroupDeleted {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "groupId")]
        group_id: String,
    },
    #[serde(rename = "user-online")]
    UserOnline { user: User },
    #[serde(rename = "user-offline")]
    UserOffline {
        #[serde(rename = "userId")]
        user_id: String,
        #[serde(rename = "lastSeenAt")]
        last_seen_at: String,
    },
    #[serde(rename = "read-receipt")]
    ReadReceipt {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "conversationType")]
        conversation_type: ConversationType,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "readerUserId")]
        reader_user_id: String,
        #[serde(rename = "readerUsername")]
        reader_username: String,
        timestamp: String,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        code: String,
        message: String,
    },
    #[serde(rename = "pong")]
    Pong { timestamp: String },
}
