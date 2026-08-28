# 语音通话问题修复总结

## 问题诊断

### 症状
1. ✓ 同一 WiFi 下可以通话
2. ✗ 手机用流量无法通话
3. ✗ 麦克风有输出但双方听不到对方
4. ✗ 挂断后显示对方"忙线中"

### 根本原因
- **NAT 穿透失败**：缺少可靠的 TURN 服务器
- **状态同步问题**：挂断后 busy 状态未及时清理

## 已完成的修复

### 1. 移动端界面优化
- 添加"通话"按钮访问在线用户
- 全屏来电通知覆盖层
- 大按钮适合触屏操作

### 2. TURN 服务器配置
**问题**：只有 STUN，无法穿透 NAT
**解决**：添加多个 TURN 服务器

现在配置的服务器：
```javascript
// STUN 服务器（3个，冗余）
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302  
stun:stun2.l.google.com:19302

// TURN 服务器 #1: Metered OpenRelay
turn:openrelay.metered.ca:80
turn:openrelay.metered.ca:443
turn:openrelay.metered.ca:443?transport=tcp

// TURN 服务器 #2: ExpressTurn (备用)
turn:relay1.expressturn.com:3478
```

### 3. 幽灵忙线状态修复
- 服务器端：使用 `setImmediate()` 确保状态清理后再广播
- 客户端：roster 更新时同步清理本地状态

### 4. WebRTC 调试增强
添加控制台日志监控：
- ICE candidate 发送/接收
- ICE 连接状态变化
- 音频轨道接收
- 连接建立/失败

## 待推送的提交

本地有 5 个提交：
```
6f180df - 添加多个备用 TURN 服务器
9a429ca - TURN 配置指南
e31014b - WebRTC 调试和音频播放改进
a0de011 - NAT 穿透和忙线状态完整修复
0fffb23 - 初始 TURN 服务器配置
```

## 推送和部署

```bash
# 推送到 GitHub
cd C:/Users/hp/chatroom
git push origin main

# Render 会自动部署
# 等待约 2-3 分钟部署完成
```

## 测试步骤

部署完成后：

1. **跨网络测试**
   - 你的电脑连 WiFi
   - 手机用流量
   - 互相拨打语音通话

2. **查看控制台日志**（F12）
   ```
   发送 ICE candidate: relay  ← 应该看到 relay 类型
   ICE 连接状态: connected  ← 应该变成 connected
   收到远程音频轨道: audio true
   远程音频播放成功
   ```

3. **状态测试**
   - 正常通话后挂断
   - 检查对方是否还显示"忙线中"
   - 应该立即恢复"空闲"状态

## 如果还有问题

### 音频问题
- 确保浏览器允许麦克风权限
- 检查系统音量和麦克风设置
- 尝试点击页面激活音频播放

### 连接问题
如果控制台显示 `ICE 连接状态: failed`，说明所有 TURN 服务器都失败了。

**长期解决方案**：
1. 注册 Metered.ca 获取专属凭证（见 `TURN_SETUP.md`）
2. 在 Render 设置环境变量：
   ```
   TURN_URL=turn:a.relay.metered.ca:80
   TURN_USERNAME=你的用户名
   TURN_CREDENTIAL=你的密码
   ```

### 移动端问题
- 确保使用 Chrome/Safari 最新版
- iOS Safari 需要手动点击允许麦克风
- 某些浏览器可能不支持 WebRTC

## 技术细节

### 为什么局域网可以，跨网络不行？

**局域网**：
```
你 (192.168.1.100) ←直连→ 对方 (192.168.1.50)
```
不需要 TURN，STUN 就够了

**跨网络**：
```
你 → 你的路由器(NAT) → 互联网 → 对方的路由器(NAT) → 对方
```
必须通过 TURN 服务器中继：
```
你 → TURN 服务器 → 对方
```

### WebRTC 连接建立过程

1. **收集 ICE candidates**
   - host: 本地 IP
   - srflx: 公网 IP (通过 STUN)
   - relay: 中继地址 (通过 TURN)

2. **交换 SDP**
   - Offer/Answer 包含媒体能力
   - ICE candidates 逐个发送

3. **ICE 状态机**
   ```
   new → checking → connected → completed
   ```

4. **音频传输**
   - 建立后音频数据开始传输
   - 监听 ontrack 事件接收远程音频

## 费用说明

当前使用的都是**免费服务**：
- Google STUN：免费
- Metered OpenRelay：免费公共服务
- ExpressTurn：免费测试服务

如果需要更稳定的服务，参考 `TURN_SETUP.md`。
