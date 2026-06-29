use worker::d1::D1Database;
use worker::Result;
use serde_json::json;
use crate::models::{User, Room, RoomUser, Transaction, PlayerInfo, TransactionDetail, GameHistory, FriendHistory};

// ==================== 用户相关操作 ====================

pub async fn find_user_by_openid(db: &D1Database, openid: &str) -> Result<Option<User>> {
    let stmt = db.prepare("SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = ?")
        .bind(&[json!(openid)])?;
    stmt.first::<User>(None).await
}

pub async fn find_user_by_id(db: &D1Database, id: i32) -> Result<Option<User>> {
    let stmt = db.prepare("SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE id = ?")
        .bind(&[json!(id)])?;
    stmt.first::<User>(None).await
}

pub async fn create_user(db: &D1Database, openid: &str, nickname: &str, avatar_url: Option<&str>) -> Result<User> {
    db.prepare("INSERT INTO users (openid, nickname, avatar_url) VALUES (?, ?, ?)")
        .bind(&[json!(openid), json!(nickname), json!(avatar_url)])?
        .run()
        .await?;
    
    let user = find_user_by_openid(db, openid).await?;
    user.ok_or_else(|| worker::Error::from("Failed to create user"))
}

pub async fn update_user(db: &D1Database, openid: &str, nickname: &str, avatar_url: Option<&str>) -> Result<()> {
    db.prepare("UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?")
        .bind(&[json!(nickname), json!(avatar_url), json!(openid)])?
        .run()
        .await?;
    Ok(())
}

// ==================== 房间相关操作 ====================

pub async fn find_room_by_code(db: &D1Database, code: &str) -> Result<Option<Room>> {
    let stmt = db.prepare("SELECT id, room_code, owner_id, total_tea_money, tea_money_per_tx, accumulated_tea_money, version, status, created_at FROM rooms WHERE room_code = ?")
        .bind(&[json!(code)])?;
    stmt.first::<Room>(None).await
}

pub async fn find_room_by_id(db: &D1Database, id: i32) -> Result<Option<Room>> {
    let stmt = db.prepare("SELECT id, room_code, owner_id, total_tea_money, tea_money_per_tx, accumulated_tea_money, version, status, created_at FROM rooms WHERE id = ?")
        .bind(&[json!(id)])?;
    stmt.first::<Room>(None).await
}

pub async fn create_room(db: &D1Database, owner_id: i32, room_code: &str) -> Result<Room> {
    db.prepare("INSERT INTO rooms (room_code, owner_id, version, status) VALUES (?, ?, 1, 0)")
        .bind(&[json!(room_code), json!(owner_id)])?
        .run()
        .await?;
    
    let room = find_room_by_code(db, room_code).await?;
    room.ok_or_else(|| worker::Error::from("Failed to create room"))
}

pub async fn is_user_in_room(db: &D1Database, room_id: i32, user_id: i32) -> Result<bool> {
    let stmt = db.prepare("SELECT COUNT(*) as count FROM room_users WHERE room_id = ? AND user_id = ?")
        .bind(&[json!(room_id), json!(user_id)])?;
    
    #[derive(serde::Deserialize)]
    struct CountResult { count: i32 }
    
    let res = stmt.first::<CountResult>(None).await?;
    Ok(res.map(|r| r.count > 0).unwrap_or(false))
}

pub async fn join_room(db: &D1Database, room_id: i32, user_id: i32) -> Result<()> {
    let exists = is_user_in_room(db, room_id, user_id).await?;
    if !exists {
        db.prepare("INSERT INTO room_users (room_id, user_id, score) VALUES (?, ?, 0)")
            .bind(&[json!(room_id), json!(user_id)])?
            .run()
            .await?;
        
        // 加入房间后递增房间版本，通知其他人更新列表
        increment_room_version(db, room_id).await?;
    }
    Ok(())
}

pub async fn get_room_players(db: &D1Database, room_id: i32) -> Result<Vec<PlayerInfo>> {
    let stmt = db.prepare(
        "SELECT ru.user_id, u.nickname, u.avatar_url, ru.score \
         FROM room_users ru \
         JOIN users u ON ru.user_id = u.id \
         WHERE ru.room_id = ?"
    ).bind(&[json!(room_id)])?;
    
    let res = stmt.all().await?;
    res.results::<PlayerInfo>()
}

pub async fn get_room_transactions(db: &D1Database, room_id: i32) -> Result<Vec<TransactionDetail>> {
    let stmt = db.prepare(
        "SELECT t.id, t.from_user_id, u1.nickname as from_nickname, \
                t.to_user_id, u2.nickname as to_nickname, \
                t.amount, t.tea_deducted, t.created_at \
         FROM transactions t \
         JOIN users u1 ON t.from_user_id = u1.id \
         JOIN users u2 ON t.to_user_id = u2.id \
         WHERE t.room_id = ? AND t.is_undone = 0 \
         ORDER BY t.id DESC"
    ).bind(&[json!(room_id)])?;
    
    let res = stmt.all().await?;
    res.results::<TransactionDetail>()
}

pub async fn update_room_tea_config(db: &D1Database, room_id: i32, total: i32, per_tx: i32) -> Result<()> {
    db.prepare("UPDATE rooms SET total_tea_money = ?, tea_money_per_tx = ? WHERE id = ?")
        .bind(&[json!(total), json!(per_tx), json!(room_id)])?
        .run()
        .await?;
    increment_room_version(db, room_id).await?;
    Ok(())
}

pub async fn increment_room_version(db: &D1Database, room_id: i32) -> Result<i32> {
    db.prepare("UPDATE rooms SET version = version + 1 WHERE id = ?")
        .bind(&[json!(room_id)])?
        .run()
        .await?;
    
    let stmt = db.prepare("SELECT version FROM rooms WHERE id = ?")
        .bind(&[json!(room_id)])?;
    
    #[derive(serde::Deserialize)]
    struct Ver { version: i32 }
    
    let res = stmt.first::<Ver>(None).await?;
    res.map(|v| v.version).ok_or_else(|| worker::Error::from("Room not found for version update"))
}

// ==================== 计分与撤销操作 ====================

pub async fn update_player_score(db: &D1Database, room_id: i32, user_id: i32, change: i32) -> Result<()> {
    db.prepare("UPDATE room_users SET score = score + ? WHERE room_id = ? AND user_id = ?")
        .bind(&[json!(change), json!(room_id), json!(user_id)])?
        .run()
        .await?;
    Ok(())
}

pub async fn insert_transaction(
    db: &D1Database, 
    room_id: i32, 
    from_user_id: i32, 
    to_user_id: i32, 
    amount: i32, 
    tea_deducted: i32
) -> Result<()> {
    db.prepare(
        "INSERT INTO transactions (room_id, from_user_id, to_user_id, amount, tea_deducted, is_undone) \
         VALUES (?, ?, ?, ?, ?, 0)"
    ).bind(&[json!(room_id), json!(from_user_id), json!(to_user_id), json!(amount), json!(tea_deducted)])?
        .run()
        .await?;
    Ok(())
}

pub async fn get_transaction_by_id(db: &D1Database, tx_id: i32) -> Result<Option<Transaction>> {
    let stmt = db.prepare("SELECT id, room_id, from_user_id, to_user_id, amount, tea_deducted, is_undone, created_at FROM transactions WHERE id = ?")
        .bind(&[json!(tx_id)])?;
    stmt.first::<Transaction>(None).await
}

pub async fn undo_transaction_in_db(db: &D1Database, tx_id: i32) -> Result<()> {
    db.prepare("UPDATE transactions SET is_undone = 1 WHERE id = ?")
        .bind(&[json!(tx_id)])?
        .run()
        .await?;
    Ok(())
}

pub async fn accumulate_tea_money(db: &D1Database, room_id: i32, amount: i32) -> Result<()> {
    db.prepare("UPDATE rooms SET accumulated_tea_money = accumulated_tea_money + ? WHERE id = ?")
        .bind(&[json!(amount), json!(room_id)])?
        .run()
        .await?;
    Ok(())
}

// ==================== 个人中心与历史战绩 ====================

pub async fn get_user_history_rooms(db: &D1Database, user_id: i32) -> Result<Vec<GameHistory>> {
    let stmt = db.prepare(
        "SELECT r.id as room_id, r.room_code, u.nickname as owner_nickname, \
                ru.score as final_score, r.accumulated_tea_money, r.created_at \
         FROM room_users ru \
         JOIN rooms r ON ru.room_id = r.id \
         JOIN users u ON r.owner_id = u.id \
         WHERE ru.user_id = ? \
         ORDER BY r.id DESC"
    ).bind(&[json!(user_id)])?;
    
    let res = stmt.all().await?;
    res.results::<GameHistory>()
}

pub async fn get_user_friends(db: &D1Database, user_id: i32) -> Result<Vec<FriendHistory>> {
    // 找出所有和当前用户在同一个房间游戏过的玩家，并统计与他们的对局总次数以及总净分（在同一局里，自己的最终得分）
    let stmt = db.prepare(
        "SELECT fu.user_id as friend_id, u.nickname, u.avatar_url, \
                COUNT(DISTINCT ru.room_id) as play_count, \
                SUM(ru.score) as net_score \
         FROM room_users ru \
         JOIN room_users fu ON ru.room_id = fu.room_id \
         JOIN users u ON fu.user_id = u.id \
         WHERE ru.user_id = ? AND fu.user_id != ? \
         GROUP BY fu.user_id, u.nickname, u.avatar_url \
         ORDER BY play_count DESC"
    ).bind(&[json!(user_id), json!(user_id)])?;
    
    let res = stmt.all().await?;
    res.results::<FriendHistory>()
}
