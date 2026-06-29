use serde::{Deserialize, Serialize};

// ==================== 数据库映射模型 ====================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i32,
    pub openid: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Room {
    pub id: i32,
    pub room_code: String,
    pub owner_id: i32,
    pub total_tea_money: i32,
    pub tea_money_per_tx: i32,
    pub accumulated_tea_money: i32,
    pub version: i32,
    pub status: i32,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RoomUser {
    pub room_id: i32,
    pub user_id: i32,
    pub score: i32,
    pub joined_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transaction {
    pub id: i32,
    pub room_id: i32,
    pub from_user_id: i32,
    pub to_user_id: i32,
    pub amount: i32,
    pub tea_deducted: i32,
    pub is_undone: i32,
    pub created_at: String,
}

// ==================== API 请求结构体 ====================

#[derive(Clone, Debug, Deserialize)]
pub struct LoginRequest {
    pub code: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateRoomRequest {
    // 允许创建房间时选填初始昵称和头像，以方便一站式登录建房
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct JoinRoomRequest {
    pub room_code: String,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetTeaRequest {
    pub room_id: i32,
    pub total_tea_money: i32,
    pub tea_money_per_tx: i32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ScoreRequest {
    pub room_id: i32,
    pub from_user_id: i32,
    pub to_user_id: i32,
    pub amount: i32,
    pub deduct_tea: bool, // 是否扣除茶水钱的开关
}

#[derive(Clone, Debug, Deserialize)]
pub struct UndoRequest {
    pub room_id: i32,
    pub transaction_id: i32,
}

// ==================== API 响应结构体 ====================

#[derive(Clone, Debug, Serialize)]
pub struct ApiResponse<T> {
    pub code: i32, // 0 表示成功，非0表示失败
    pub message: String,
    pub data: Option<T>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LoginResponse {
    pub token: String, // 实际开发中可以使用 openid 或者简单签名，这里使用 openid 加密/或直接用 openid 作为简易 token 传递
    pub user: User,
}

#[derive(Clone, Debug, Serialize)]
pub struct PlayerInfo {
    pub user_id: i32,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub score: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct TransactionDetail {
    pub id: i32,
    pub from_user_id: i32,
    pub from_nickname: String,
    pub to_user_id: i32,
    pub to_nickname: String,
    pub amount: i32,
    pub tea_deducted: i32,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PollResponse {
    pub has_update: bool,
    pub room: Option<Room>,
    pub players: Option<Vec<PlayerInfo>>,
    pub transactions: Option<Vec<TransactionDetail>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FriendHistory {
    pub friend_id: i32,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub play_count: i32,
    pub net_score: i32, // 与该好友对局的净输赢分值（本计分器是手动的，可以计算所有在该玩家在场的对局中，当前玩家的得分总和）
}

#[derive(Clone, Debug, Serialize)]
pub struct GameHistory {
    pub room_id: i32,
    pub room_code: String,
    pub owner_nickname: String,
    pub final_score: i32,
    pub accumulated_tea_money: i32,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProfileResponse {
    pub history: Vec<GameHistory>,
    pub friends: Vec<FriendHistory>,
}
