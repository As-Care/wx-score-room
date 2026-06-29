use worker::*;
use serde_json::json;

mod models;
mod db;

use models::{ApiResponse, LoginResponse, PollResponse, ProfileResponse};

// ==================== CORS 辅助函数 ====================

fn add_cors_headers(mut res: Response) -> Result<Response> {
    let headers = res.headers_mut();
    headers.set("Access-Control-Allow-Origin", "*")?;
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")?;
    Ok(res)
}

fn handle_options() -> Result<Response> {
    let res = Response::empty()?;
    add_cors_headers(res)
}

// ==================== API 统一响应 ====================

fn json_ok<T: serde::Serialize>(data: T) -> Result<Response> {
    let body = ApiResponse {
        code: 0,
        message: "success".to_string(),
        data: Some(data),
    };
    let res = Response::from_json(&body)?;
    add_cors_headers(res)
}

fn json_err(code: i32, msg: &str) -> Result<Response> {
    let body: ApiResponse<Option<()>> = ApiResponse {
        code,
        message: msg.to_string(),
        data: None,
    };
    let res = Response::from_json(&body)?;
    add_cors_headers(res)
}

// ==================== 身份验证 ====================

async fn authenticate(req: &Request, db: &worker::d1::D1Database) -> Result<std::result::Result<models::User, Response>> {
    let headers = req.headers();
    let auth_header = match headers.get("Authorization")? {
        Some(val) => val,
        None => return Ok(Err(json_err(401, "未携带登录授权凭证").unwrap())),
    };
    
    let token = auth_header.trim_start_matches("Bearer ").trim();
    if token.is_empty() {
        return Ok(Err(json_err(401, "授权凭证为空").unwrap()));
    }
    
    match db::find_user_by_openid(db, token).await? {
        Some(user) => Ok(Ok(user)),
        None => {
            // 自动降级注册：防止首次登录出错
            let short_id = if token.len() > 4 { &token[token.len()-4..] } else { "玩家" };
            let default_name = format!("玩家_{}", short_id);
            match db::create_user(db, token, &default_name, None).await {
                Ok(new_user) => Ok(Ok(new_user)),
                Err(_) => Ok(Err(json_err(401, "用户自动注册失败").unwrap()))
            }
        }
    }
}

// ==================== 微信登录降级处理 ====================

async fn fetch_openid(code: &str, env: &Env) -> String {
    let appid = env.var("WX_APPID").map(|v| v.to_string()).unwrap_or_default();
    let secret = env.var("WX_SECRET").map(|v| v.to_string()).unwrap_or_default();
    
    // 如果没有配置微信凭证，或者前端传入的是测试类 code，直接将 code 转换为 mock openid
    if appid.is_empty() || secret.is_empty() || code.starts_with("test_") || code == "the code is a mock one" {
        return format!("mock_openid_{}", code);
    }
    
    let url = format!(
        "https://api.weixin.qq.com/sns/jscode2session?appid={}&secret={}&js_code={}&grant_type=authorization_code",
        appid, secret, code
    );
    
    match Fetch::Url(url.parse().unwrap()).send().await {
        Ok(mut resp) => {
            #[derive(serde::Deserialize)]
            struct WxSessionResponse {
                openid: Option<String>,
            }
            if let Ok(res_body) = resp.json::<WxSessionResponse>().await {
                if let Some(openid) = res_body.openid {
                    return openid;
                }
            }
            format!("mock_openid_{}", code)
        }
        Err(_) => format!("mock_openid_{}", code),
    }
}

// ==================== 随机房间号生成 ====================

fn generate_room_code() -> String {
    let val = (js_sys::Math::random() * 900000.0) as i32 + 100000;
    val.to_string()
}

// ==================== 主逻辑路由入口 ====================

#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: worker::Context) -> Result<Response> {
    if req.method() == Method::Options {
        return handle_options();
    }

    let router = Router::new();
    
    router
        // 1. 微信登录 / 注册
        .post_async("/api/user/login", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let body: models::LoginRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            let openid = fetch_openid(&body.code, &ctx.env).await;
            
            let user = match db::find_user_by_openid(&db, &openid).await? {
                Some(u) => u,
                None => {
                    let short_id = if openid.len() > 4 { &openid[openid.len()-4..] } else { "新玩家" };
                    let default_name = format!("玩家_{}", short_id);
                    db::create_user(&db, &openid, &default_name, None).await?
                }
            };
            
            json_ok(LoginResponse {
                token: openid,
                user,
            })
        })
        
        // 2. 更新个人信息
        .post_async("/api/user/update", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::UpdateUserRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            db::update_user(&db, &user.openid, &body.nickname, body.avatar_url.as_deref()).await?;
            
            let updated_user = db::find_user_by_openid(&db, &user.openid).await?.unwrap();
            json_ok(updated_user)
        })
        
        // 3. 开房（创建房间并自动加入）
        .post_async("/api/room/create", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::CreateRoomRequest = req.json().await.unwrap_or(models::CreateRoomRequest { nickname: None, avatar_url: None });
            
            // 如果传入了头像昵称，顺便更新
            if let Some(ref nick) = body.nickname {
                db::update_user(&db, &user.openid, nick, body.avatar_url.as_deref()).await?;
            }
            
            // 循环尝试生成不重复的房间号
            let mut room_code = generate_room_code();
            for _ in 0..10 {
                if db::find_room_by_code(&db, &room_code).await?.is_none() {
                    break;
                }
                room_code = generate_room_code();
            }
            
            let room = db::create_room(&db, user.id, &room_code).await?;
            db::join_room(&db, room.id, user.id).await?;
            
            json_ok(room)
        })
        
        // 4. 加入房间
        .post_async("/api/room/join", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::JoinRoomRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            if let Some(ref nick) = body.nickname {
                db::update_user(&db, &user.openid, nick, body.avatar_url.as_deref()).await?;
            }
            
            let room = match db::find_room_by_code(&db, &body.room_code).await? {
                Some(r) => r,
                None => return json_err(404, "房间不存在"),
            };
            
            if room.status == 1 {
                return json_err(403, "该房间游戏已结算结束");
            }
            
            db::join_room(&db, room.id, user.id).await?;
            json_ok(room)
        })
        
        // 5. 设置/修改茶水钱
        .post_async("/api/room/set-tea", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let _user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::SetTeaRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            db::update_room_tea_config(&db, body.room_id, body.total_tea_money, body.tea_money_per_tx).await?;
            json_ok(json!({ "status": "ok" }))
        })
        
        // 6. 记分（支持茶水扣除开关）
        .post_async("/api/room/score", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let _user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::ScoreRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            if body.amount <= 0 {
                return json_err(400, "分数必须大于0");
            }
            
            if body.from_user_id == body.to_user_id {
                return json_err(400, "不能给自己记分");
            }
            
            let room = match db::find_room_by_id(&db, body.room_id).await? {
                Some(r) => r,
                None => return json_err(404, "房间不存在"),
            };
            
            if room.status == 1 {
                return json_err(403, "房间已结束结算");
            }
            
            // 计算实际需要扣除的茶水钱
            let mut tea_deducted = 0;
            if body.deduct_tea && room.tea_money_per_tx > 0 {
                let remaining_tea = room.total_tea_money - room.accumulated_tea_money;
                if remaining_tea > 0 {
                    // 扣除数不能超过每笔扣除额、剩余茶水额、以及该笔交易金额
                    tea_deducted = std::cmp::min(room.tea_money_per_tx, remaining_tea);
                    tea_deducted = std::cmp::min(tea_deducted, body.amount);
                }
            }
            
            let final_score_change = body.amount - tea_deducted;
            
            // 执行原子变更
            // 1. 付分人扣去原始分
            db::update_player_score(&db, body.room_id, body.from_user_id, -body.amount).await?;
            // 2. 得分人加上扣除茶水后的实得分
            db::update_player_score(&db, body.room_id, body.to_user_id, final_score_change).await?;
            
            // 3. 如果扣了茶水，累加到房间茶水池中
            if tea_deducted > 0 {
                db::accumulate_tea_money(&db, body.room_id, tea_deducted).await?;
            }
            
            // 4. 插入记分历史流水
            db::insert_transaction(&db, body.room_id, body.from_user_id, body.to_user_id, body.amount, tea_deducted).await?;
            
            // 5. 递增房间版本
            db::increment_room_version(&db, body.room_id).await?;
            
            json_ok(json!({ "status": "ok" }))
        })
        
        // 7. 撤销记分
        .post_async("/api/room/undo", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let _user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let body: models::UndoRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            let tx = match db::get_transaction_by_id(&db, body.transaction_id).await? {
                Some(t) => t,
                None => return json_err(404, "流水记录不存在"),
            };
            
            if tx.is_undone == 1 {
                return json_err(400, "该记录已被撤销，无需重复操作");
            }
            
            let room = match db::find_room_by_id(&db, body.room_id).await? {
                Some(r) => r,
                None => return json_err(404, "房间不存在"),
            };
            
            if room.status == 1 {
                return json_err(403, "房间已结束结算，无法撤销");
            }
            
            // 逆向积分计算与回滚
            let original_amount = tx.amount;
            let tea_deducted = tx.tea_deducted;
            let final_score_change = original_amount - tea_deducted;
            
            // 1. 原付分人退回原始分数
            db::update_player_score(&db, body.room_id, tx.from_user_id, original_amount).await?;
            // 2. 原得分人扣除刚才的实得分
            db::update_player_score(&db, body.room_id, tx.to_user_id, -final_score_change).await?;
            
            // 3. 回滚茶水钱池累积
            if tea_deducted > 0 {
                db::accumulate_tea_money(&db, body.room_id, -tea_deducted).await?;
            }
            
            // 4. 将该笔记录状态标记为已撤销
            db::undo_transaction_in_db(&db, tx.id).await?;
            
            // 5. 递增房间版本
            db::increment_room_version(&db, body.room_id).await?;
            
            json_ok(json!({ "status": "ok" }))
        })
        
        // 8. 房间实时轮询 (1秒1次智能轮询)
        .get_async("/api/room/poll", |req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let _user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let url = req.url()?;
            let query = url.query_pairs();
            
            let mut room_id = 0;
            let mut local_version = 0;
            
            for (k, v) in query {
                if k == "room_id" {
                    room_id = v.parse::<i32>().unwrap_or(0);
                } else if k == "local_version" {
                    local_version = v.parse::<i32>().unwrap_or(0);
                }
            }
            
            if room_id == 0 {
                return json_err(400, "缺失房间 room_id 参数");
            }
            
            let room = match db::find_room_by_id(&db, room_id).await? {
                Some(r) => r,
                None => return json_err(404, "房间不存在"),
            };
            
            // 核心：若客户端版本和数据库最新版本一致，立刻返回 has_update = false，节省流量和性能
            if room.version == local_version {
                return json_ok(PollResponse {
                    has_update: false,
                    room: None,
                    players: None,
                    transactions: None,
                });
            }
            
            // 否则拉取完整的数据
            let players = db::get_room_players(&db, room_id).await?;
            let transactions = db::get_room_transactions(&db, room_id).await?;
            
            json_ok(PollResponse {
                has_update: true,
                room: Some(room),
                players: Some(players),
                transactions: Some(transactions),
            })
        })
        
        // 9. 结束游戏结算房间
        .post_async("/api/room/settle", |mut req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            #[derive(serde::Deserialize)]
            struct SettleRequest { room_id: i32 }
            let body: SettleRequest = match req.json().await {
                Ok(b) => b,
                Err(_) => return json_err(400, "参数格式错误"),
            };
            
            let room = match db::find_room_by_id(&db, body.room_id).await? {
                Some(r) => r,
                None => return json_err(404, "房间不存在"),
            };
            
            if room.owner_id != user.id {
                return json_err(403, "只有房主才可以结算房间游戏");
            }
            
            db.prepare("UPDATE rooms SET status = 1 WHERE id = ?")
                .bind(&[json!(body.room_id)])?
                .run()
                .await?;
            
            db::increment_room_version(&db, body.room_id).await?;
            json_ok(json!({ "status": "ok" }))
        })
        
        // 10. 个人中心历史与战绩
        .get_async("/api/user/history", |req, ctx| async move {
            let db = ctx.env.d1("DB")?;
            let user = match authenticate(&req, &db).await? {
                Ok(u) => u,
                Err(err_resp) => return Ok(err_resp),
            };
            
            let history = db::get_user_history_rooms(&db, user.id).await?;
            let friends = db::get_user_friends(&db, user.id).await?;
            
            json_ok(ProfileResponse {
                history,
                friends,
            })
        })
        
        .run(req, env).await
}
