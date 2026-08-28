# TURN 服务器配置指南

## 问题说明

当前使用的免费 TURN 服务器（openrelay.metered.ca）不稳定，导致跨网络语音通话失败。

**症状**：
- 同一 WiFi 下可以通话 ✓
- 使用手机流量无法通话 ✗
- 控制台显示 `ICE 连接状态: failed`

## 解决方案

### 方案 1：使用 Metered.ca（推荐，最简单）

Metered 提供免费的 TURN 服务，每月 50GB 流量。

1. 访问 https://www.metered.ca/tools/openrelay/
2. 获取你的专属 TURN 服务器配置
3. 在 Render 环境变量中设置：

```bash
TURN_URL=turn:a.relay.metered.ca:80,turn:a.relay.metered.ca:80?transport=tcp,turn:a.relay.metered.ca:443,turn:a.relay.metered.ca:443?transport=tcp
TURN_USERNAME=你的用户名
TURN_CREDENTIAL=你的密码
```

### 方案 2：使用 Twilio（最稳定）

Twilio 提供企业级 TURN 服务，有免费试用额度。

1. 注册 Twilio 账号：https://www.twilio.com/
2. 获取 API Key 和 Secret
3. Twilio 的 TURN 服务器会动态生成凭证

需要修改代码来调用 Twilio API 获取临时凭证：

```javascript
// 在 server.js 中添加
app.get("/api/rtc-config", async (_req, res) => {
  // Twilio 动态凭证逻辑
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (accountSid && authToken) {
    // 调用 Twilio API 获取 ICE 服务器
    const client = require('twilio')(accountSid, authToken);
    const token = await client.tokens.create();
    return res.json({ iceServers: token.iceServers });
  }
  
  // 降级到默认配置
  res.json({ iceServers: DEFAULT_ICE_SERVERS });
});
```

### 方案 3：自建 TURN 服务器（最灵活）

使用 coturn 在自己的服务器上部署。

1. 准备一台公网服务器（VPS）
2. 安装 coturn：

```bash
sudo apt-get install coturn
```

3. 配置 `/etc/turnserver.conf`：

```
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=你的密钥
realm=yourdomain.com
total-quota=100
stale-nonce=600
cert=/etc/letsencrypt/live/yourdomain.com/cert.pem
pkey=/etc/letsencrypt/live/yourdomain.com/privkey.pem
no-stdout-log
```

4. 启动服务：

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

5. 在 Render 设置环境变量：

```bash
TURN_URL=turn:你的服务器IP:3478
TURN_USERNAME=用户名
TURN_CREDENTIAL=密码
```

## 当前配置（仅作为后备）

客户端硬编码了 openrelay.metered.ca 作为后备，但不稳定。建议：

1. 设置环境变量优先使用更可靠的 TURN
2. 客户端会自动从 `/api/rtc-config` 获取配置

## 测试 TURN 服务器

使用 Trickle ICE 测试工具：https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

填入你的 TURN 配置，点击"Gather candidates"，应该看到 `relay` 类型的候选。

## 部署步骤

1. 选择一个方案（推荐方案 1）
2. 在 Render Dashboard → 你的服务 → Environment 中添加环境变量
3. 重新部署服务
4. 测试跨网络通话

## 费用估算

- **Metered.ca 免费版**：50GB/月，足够小规模使用
- **Twilio**：$0.0005/分钟，有免费试用额度
- **自建 coturn**：VPS 费用约 $5-10/月
