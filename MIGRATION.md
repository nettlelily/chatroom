# PostgreSQL 迁移指南

本项目已从 SQLite 迁移到 PostgreSQL，以支持 Render 免费部署时的数据持久化。

## 本地开发设置

### 1. 安装 PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Windows:**
下载并安装 PostgreSQL: https://www.postgresql.org/download/windows/

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. 创建测试数据库

```bash
# 创建数据库
createdb chatroom_dev

# 或使用 psql
psql -U postgres
CREATE DATABASE chatroom_dev;
CREATE DATABASE chatroom_test;
\q
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`:

```bash
cp .env.example .env
```

编辑 `.env` 文件，设置数据库连接：

```env
DATABASE_URL=postgresql://localhost:5432/chatroom_dev
SESSION_SECRET=your-random-secret-here
```

### 4. 安装依赖并启动

```bash
npm install
npm start
```

服务器会自动初始化数据库表结构。

## 生产部署（Render）

### 1. 创建外部 PostgreSQL 数据库

推荐使用以下免费提供商之一：

**选项 A: Neon (推荐)**
- 访问 https://neon.tech
- 创建账号并新建项目
- 复制连接字符串（格式：`postgresql://user:pass@host/db?sslmode=require`）

**选项 B: Supabase**
- 访问 https://supabase.com
- 创建项目
- 在 Settings → Database 中复制连接字符串

### 2. 在 Render 配置环境变量

1. 打开 Render Dashboard，选择你的 `chatroom` 服务
2. 进入 Environment 标签页
3. 添加环境变量：
   - `DATABASE_URL`: 粘贴从 Neon/Supabase 复制的连接字符串（标记为 Secret）
   - `SESSION_SECRET`: 自动生成（已在 render.yaml 配置）
   - `ANTHROPIC_AUTH_TOKEN`: 你的 Claude API token（可选，标记为 Secret）

### 3. 推送代码并部署

```bash
git add .
git commit -m "迁移到 PostgreSQL"
git push
```

Render 会自动触发部署。

### 4. 验证部署

访问 `https://chatroom-bjfo.onrender.com`，注册账号并发送消息。

等待 15 分钟让服务进入冷启动，或手动重启服务，然后再次访问，确认账号和消息未丢失。

## 从现有 SQLite 迁移数据（可选）

如果你有现有的 SQLite 数据库需要迁移到 PostgreSQL：

### 1. 下载现有 SQLite 数据（如果在 Render）

注意：Render 免费层的磁盘是临时性的，如果服务已重启过，SQLite 数据已经丢失，无需迁移。

### 2. 运行迁移脚本

```bash
DATABASE_URL=postgresql://localhost:5432/chatroom_dev node scripts/migrate-to-postgres.js ./data/chatroom.sqlite
```

或迁移到远程 PostgreSQL：

```bash
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node scripts/migrate-to-postgres.js ./data/chatroom.sqlite
```

## 运行测试

测试需要本地 PostgreSQL 数据库：

```bash
# 确保 chatroom_test 数据库存在
createdb chatroom_test

# 运行测试
npm test
```

测试会自动清理测试数据。

## 常见问题

**Q: 本地开发时连接 PostgreSQL 失败？**

A: 检查：
1. PostgreSQL 服务是否运行：`pg_isready`
2. 数据库是否存在：`psql -l | grep chatroom`
3. 连接字符串格式：`postgresql://username:password@localhost:5432/database`

**Q: Render 部署后仍然丢失数据？**

A: 确认：
1. `DATABASE_URL` 环境变量已正确设置
2. 连接字符串包含 `?sslmode=require`（Neon 需要）
3. 查看 Render 日志，确认没有数据库连接错误

**Q: 测试失败？**

A: 确保：
1. `chatroom_test` 数据库存在
2. PostgreSQL 用户有创建表的权限
3. 运行 `npm install` 安装了最新依赖

## 性能对比

- SQLite（本地文件）：写入延迟 ~1-5ms
- PostgreSQL（外部，如 Neon）：写入延迟 ~20-50ms

对于聊天室应用，这个延迟完全可以接受。PostgreSQL 的优势是数据持久化和并发能力。
