#!/usr/bin/env node

const Database = require("better-sqlite3");
const { Pool } = require("pg");

async function migrate() {
  const sqlitePath = process.argv[2];
  const postgresUrl = process.env.DATABASE_URL;

  if (!sqlitePath) {
    console.error("用法: node migrate-to-postgres.js <sqlite-db-path>");
    console.error("示例: node migrate-to-postgres.js ./data/chatroom.sqlite");
    process.exit(1);
  }

  if (!postgresUrl) {
    console.error("错误: 请设置 DATABASE_URL 环境变量");
    console.error("示例: DATABASE_URL=postgresql://user:pass@host:5432/db node migrate-to-postgres.js ./data/chatroom.sqlite");
    process.exit(1);
  }

  console.log(`从 SQLite 迁移: ${sqlitePath}`);
  console.log(`到 PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log();

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = new Pool({ connectionString: postgresUrl });

  try {
    const users = sqlite.prepare("SELECT * FROM users ORDER BY id").all();
    console.log(`发现 ${users.length} 个用户`);

    for (const user of users) {
      await pool.query(
        `INSERT INTO users (id, username, password_hash, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.username, user.password_hash, user.created_at]
      );
    }
    console.log(`✓ 用户迁移完成`);

    const messages = sqlite.prepare("SELECT * FROM messages ORDER BY id").all();
    console.log(`发现 ${messages.length} 条消息`);

    for (const message of messages) {
      await pool.query(
        `INSERT INTO messages (id, user_id, text, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [message.id, message.user_id, message.text, message.created_at]
      );
    }
    console.log(`✓ 消息迁移完成`);

    const attachments = sqlite.prepare("SELECT * FROM attachments ORDER BY message_id").all();
    console.log(`发现 ${attachments.length} 个附件`);

    for (const attachment of attachments) {
      await pool.query(
        `INSERT INTO attachments (message_id, filename, mime_type, size, data_base64)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (message_id) DO NOTHING`,
        [attachment.message_id, attachment.filename, attachment.mime_type, attachment.size, attachment.data_base64]
      );
    }
    console.log(`✓ 附件迁移完成`);

    const maxUserId = await pool.query(`SELECT MAX(id) as max_id FROM users`);
    if (maxUserId.rows[0].max_id) {
      await pool.query(`SELECT setval('users_id_seq', $1, true)`, [maxUserId.rows[0].max_id]);
    }

    const maxMessageId = await pool.query(`SELECT MAX(id) as max_id FROM messages`);
    if (maxMessageId.rows[0].max_id) {
      await pool.query(`SELECT setval('messages_id_seq', $1, true)`, [maxMessageId.rows[0].max_id]);
    }
    console.log(`✓ 序列重置完成`);

    console.log();
    console.log("🎉 迁移成功完成！");
  } catch (error) {
    console.error("迁移失败:", error);
    process.exit(1);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

migrate();
