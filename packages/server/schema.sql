-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openid TEXT UNIQUE NOT NULL,      -- 微信用户的唯一标识 (用作登录凭证)
    nickname TEXT NOT NULL,           -- 昵称
    avatar_url TEXT,                  -- 头像链接
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 房间表
CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT UNIQUE NOT NULL,    -- 6位随机数字房间号 (例如 "129843")
    owner_id INTEGER NOT NULL,         -- 房主 (关联 users.id)
    total_tea_money INTEGER DEFAULT 0, -- 总茶水钱上限金额
    tea_money_per_tx INTEGER DEFAULT 0,-- 每笔交易扣除的茶水钱
    accumulated_tea_money INTEGER DEFAULT 0, -- 当前已收取的茶水钱总数
    version INTEGER DEFAULT 1,         -- 房间版本号 (每次分数变动/设置茶水/撤销，此值自增 1)
    status INTEGER DEFAULT 0,          -- 房间状态 (0: 进行中, 1: 已结算/结束)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 3. 房间成员关联表
CREATE TABLE IF NOT EXISTS room_users (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,           -- 玩家在该房间内的当前积分
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 4. 记分交易流水表
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,     -- 付分人 (扣分的人)
    to_user_id INTEGER NOT NULL,       -- 得分人 (加分的人)
    amount INTEGER NOT NULL,           -- 本次记分的原始额度
    tea_deducted INTEGER DEFAULT 0,    -- 本次交易实际扣除的茶水钱
    is_undone INTEGER DEFAULT 0,       -- 是否已撤销 (0: 正常, 1: 已撤销)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
);
