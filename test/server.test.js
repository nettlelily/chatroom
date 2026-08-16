const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { io: Client } = require("socket.io-client");
const request = require("supertest");
const { createChatServer } = require("../server");

function waitForCount(list, count, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    if (list.length >= count) {
      resolve();
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (list.length >= count) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${count} events, got ${list.length}`));
      }
    }, 10);
  });
}

async function startTestServer(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatroom-test-"));
  const chatServer = createChatServer({
    dbPath: path.join(tempDir, "chatroom.sqlite"),
    port: 0,
    sessionSecret: "test-secret",
    claudeCooldownMs: 200,
    ...options
  });

  await new Promise((resolve) => {
    chatServer.server.listen(0, "127.0.0.1", resolve);
  });

  const address = chatServer.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    ...chatServer,
    tempDir,
    baseUrl,
    async cleanup() {
      await chatServer.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function registerAndConnect(chatServer, username, password = "secret123") {
  const agent = request.agent(chatServer.app);
  const registerResponse = await agent.post("/api/register").send({ username, password }).expect(201);

  const cookieHeader = (registerResponse.headers["set-cookie"] || [])
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

  const socket = Client(chatServer.baseUrl, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: cookieHeader
      ? {
          Cookie: cookieHeader
        }
      : undefined
  });

  const connected = once(socket, "connect");
  const historyReceived = once(socket, "history");
  const joinedReceived = once(socket, "joined");
  socket.connect();

  await connected;
  await historyReceived;
  const [joined] = await joinedReceived;

  return { agent, socket, joined };
}

test("plain messages broadcast without Claude reply", async () => {
  const chatServer = await startTestServer({
    claudeReply: async () => "should not happen"
  });

  try {
    const { socket } = await registerAndConnect(chatServer, "alice");
    const chatEvents = [];
    socket.on("chat", (payload) => {
      chatEvents.push(payload);
    });

    socket.emit("chat", "大家好");
    await waitForCount(chatEvents, 1);

    assert.equal(chatEvents.length, 1);
    assert.equal(chatEvents[0].name, "alice");
    assert.equal(chatEvents[0].text, "大家好");
    assert.equal(chatEvents[0].bot, false);

    socket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});

test("@Claude triggers one bot reply and keeps bot messages transient", async () => {
  const prompts = [];
  const chatServer = await startTestServer({
    claudeReply: async (payload) => {
      prompts.push(payload);
      return "收到，我来帮你。";
    }
  });

  try {
    const { socket } = await registerAndConnect(chatServer, "alice");
    const chatEvents = [];
    socket.on("chat", (payload) => {
      chatEvents.push(payload);
    });

    socket.emit("chat", "@Claude 帮我总结一下");
    await waitForCount(chatEvents, 2);

    assert.equal(chatEvents.length, 2);
    assert.equal(chatEvents[0].name, "alice");
    assert.equal(chatEvents[0].bot, false);
    assert.equal(chatEvents[1].name, "Claude");
    assert.equal(chatEvents[1].text, "收到，我来帮你。");
    assert.equal(chatEvents[1].bot, true);
    assert.equal(chatEvents[1].persistent, false);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].userName, "alice");
    assert.equal(prompts[0].text, "@Claude 帮我总结一下");

    socket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});

test("Claude mention cooldown and in-flight guard return system messages", async () => {
  let releaseReply;
  const chatServer = await startTestServer({
    claudeCooldownMs: 1000,
    claudeReply: () => new Promise((resolve) => {
      releaseReply = resolve;
    })
  });

  try {
    const { socket } = await registerAndConnect(chatServer, "alice");
    const systemEvents = [];
    const chatEvents = [];
    socket.on("system", (payload) => {
      systemEvents.push(payload);
    });
    socket.on("chat", (payload) => {
      chatEvents.push(payload);
    });

    socket.emit("chat", "@Claude 第一条");
    await waitForCount(chatEvents, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    socket.emit("chat", "@Claude 第二条");
    await waitForCount(systemEvents, 1);
    const busySystem = systemEvents.at(-1);
    assert.match(busySystem.text, /正在回复上一条消息/);

    releaseReply("好的，第一条处理完了");
    await waitForCount(chatEvents, 3);

    socket.emit("chat", "@Claude 第三条");
    await waitForCount(systemEvents, 2);
    const cooldownSystem = systemEvents.at(-1);
    assert.match(cooldownSystem.text, /冷却中/);

    socket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});

test("register rejects reserved Claude username", async () => {
  const chatServer = await startTestServer();

  try {
    await request(chatServer.app)
      .post("/api/register")
      .send({ username: "Claude", password: "secret123" })
      .expect(400)
      .expect((response) => {
        assert.equal(response.body.error, "该用户名不可用");
      });
  } finally {
    await chatServer.cleanup();
  }
});
