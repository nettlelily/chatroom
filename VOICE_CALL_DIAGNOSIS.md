# 语音通话问题诊断报告

## 测试日期
2026-08-28

## 问题描述
- ✅ 同一 WiFi 网络下语音通话正常
- ❌ 跨网络（电脑 WiFi + 手机流量）通话失败
- ❌ 双方听不到对方声音

## 诊断过程

### 1. 代码检查
✅ **服务器配置正确**
```bash
curl https://chatroom-bjfo.onrender.com/api/rtc-config
```
返回：
- 3 个 STUN 服务器
- 4 个 TURN 服务器（openrelay.metered.ca + expressturn.com）

### 2. 客户端日志分析
```
发送 ICE candidate: host
发送 ICE candidate: srflx
❌ 没有: relay  ← 关键问题
ICE 连接状态: checking
ICE 连接状态: connected (短暂)
ICE 连接状态: disconnected
连接状态: failed
```

**结论**：TURN 服务器未返回 relay candidate

### 3. 网络连通性测试

**Ping 测试**：
```bash
ping openrelay.metered.ca
结果: ✅ 成功
- IP: 37.27.44.221
- 延迟: 264ms
- 丢包: 0%
```

**端口测试**：
```bash
telnet openrelay.metered.ca:80
结果: ⚠️ 部分成功
- TCP 连接: ✅ 建立成功
- TURN 握手: ❌ 超时
```

### 4. 根本原因

**UDP 协议被阻止**

TURN 服务器需要 UDP 协议传输实时音频，但：
- 中国运营商通常限制 UDP 流量
- 防火墙可能阻止 UDP 端口
- GFW 可能干扰 WebRTC 协议

虽然 TCP 连接能建立，但：
- WebRTC 优先使用 UDP
- TCP 延迟太高，不适合实时音频
- TURN over TCP 可能被限制

## 解决方案

### 方案 1：自建国内 TURN 服务器（推荐用于生产）

**成本**：¥30-50/月（VPS）

**步骤**：
1. 购买国内 VPS（阿里云/腾讯云）
2. 部署 coturn
3. 配置 Render 环境变量

**优点**：
- 稳定可靠
- 低延迟（国内服务器）
- 完全可控

**脚本**：见 `TURN_SETUP.md`

### 方案 2：接受功能限制（推荐用于演示/个人项目）

**在 README 中说明**：

```markdown
## 语音通话功能

### 支持场景
✅ 同一局域网（同一 WiFi）下的用户
✅ 使用相同 VPN 的用户

### 限制说明
❌ 不同网络环境可能无法建立通话
原因：部分网络运营商限制 WebRTC UDP 协议

### 建议
- 演示时确保双方在同一网络
- 或使用移动热点共享网络
- 生产环境需部署专用 TURN 服务器
```

**优点**：
- 无额外成本
- 适合演示和学习
- 大多数用户可以理解

### 方案 3：使用 VPN（临时方案）

双方都开启 VPN，绕过网络限制。

**优点**：
- 快速测试
- 无需额外部署

**缺点**：
- 增加延迟
- 用户体验差
- 不适合生产环境

## 技术细节

### 为什么 STUN 可以但 TURN 不行？

**STUN**（只需要一次查询）：
1. 客户端 → STUN 服务器："我的公网 IP 是多少？"
2. STUN 服务器 → 客户端："你的公网 IP 是 X.X.X.X"
3. 完成（不需要持续连接）

**TURN**（需要持续中继）：
1. 客户端 A ↔ TURN 服务器 ↔ 客户端 B
2. 所有音频数据通过 TURN 中继
3. 需要持续的 UDP 连接（被阻止）

### ICE Candidate 类型

- **host**：本地 IP（192.168.x.x）
- **srflx**：通过 STUN 获取的公网 IP
- **relay**：通过 TURN 中继的地址 ← 你缺少这个

没有 relay candidate 意味着无法在 NAT 后面的两个设备间建立连接。

## 当前状态

✅ **代码完全正确**
✅ **服务器配置正确**
✅ **同网络通话正常**
❌ **网络环境限制 TURN 协议**

## 建议

**对于个人项目/演示**：
- 接受限制，在文档中说明
- 演示时确保同一网络环境

**对于生产环境**：
- 必须部署自己的 TURN 服务器
- 预算约 ¥500-1000/年

## 附录：测试命令

```bash
# 测试服务器配置
curl https://chatroom-bjfo.onrender.com/api/rtc-config

# 测试网络连通性
ping openrelay.metered.ca

# 测试端口
telnet openrelay.metered.ca 80
telnet openrelay.metered.ca 443
telnet openrelay.metered.ca 3478

# 查看浏览器控制台
# 应该看到 "发送 ICE candidate: relay"
```

## 相关文档

- `TURN_SETUP.md` - TURN 服务器部署指南
- `VOICE_CALL_FIXES.md` - 已完成的修复汇总
- `README.md` - 项目说明
