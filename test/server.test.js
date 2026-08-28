const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { io: Client } = require("socket.io-client");
const request = require("supertest");
const { Pool } = require("pg");
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
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/chatroom_test",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
  });

  await pool.query(`
    DROP TABLE IF EXISTS attachments CASCADE;
    DROP TABLE IF EXISTS messages CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);

  const chatServer = createChatServer({
    pool,
    port: 0,
    sessionSecret: "test-secret",
    claudeCooldownMs: 200,
    ...options
  });

  await chatServer.start();

  const address = chatServer.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    ...chatServer,
    baseUrl,
    async cleanup() {
      await chatServer.close();
      await pool.query(`
        DROP TABLE IF EXISTS attachments CASCADE;
        DROP TABLE IF EXISTS messages CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
      `);
      await pool.end();
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

test("roster lists other logged-in users and excludes current user", async () => {
  const chatServer = await startTestServer();

  try {
    const { socket: aliceSocket, joined: aliceJoined } = await registerAndConnect(chatServer, "alice");
    const rosters = [];
    aliceSocket.on("roster", (payload) => {
      rosters.push(payload);
    });

    const { socket: bobSocket, joined: bobJoined } = await registerAndConnect(chatServer, "bob");
    await waitForCount(rosters, 1);

    const latestRoster = rosters.at(-1);
    assert.ok(Array.isArray(latestRoster));
    assert.deepEqual(
      latestRoster.map((user) => user.name).sort(),
      ["alice", "bob"]
    );

    const aliceVisibleToAlice = latestRoster.some((user) => user.userId === aliceJoined.userId);
    const bobVisibleToAlice = latestRoster.some((user) => user.userId === bobJoined.userId);
    assert.equal(aliceVisibleToAlice, true);
    assert.equal(bobVisibleToAlice, true);

    aliceSocket.disconnect();
    bobSocket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});

test("call invite forwards to target and accept enables signaling", async () => {
  const chatServer = await startTestServer();

  try {
    const { socket: aliceSocket, joined: aliceJoined } = await registerAndConnect(chatServer, "alice");
    const { socket: bobSocket, joined: bobJoined } = await registerAndConnect(chatServer, "bob");

    const incomingEvents = [];
    const acceptedEvents = [];
    const signalEvents = [];

    bobSocket.on("call:incoming", (payload) => incomingEvents.push(payload));
    aliceSocket.on("call:accepted", (payload) => acceptedEvents.push(payload));
    bobSocket.on("call:signal", (payload) => signalEvents.push(payload));

    aliceSocket.emit("call:invite", { toUserId: bobJoined.userId });
    await waitForCount(incomingEvents, 1);
    assert.equal(incomingEvents[0].from.userId, aliceJoined.userId);
    assert.equal(incomingEvents[0].from.name, "alice");

    bobSocket.emit("call:accept", { withUserId: aliceJoined.userId });
    await waitForCount(acceptedEvents, 1);
    assert.equal(acceptedEvents[0].from.userId, bobJoined.userId);

    aliceSocket.emit("call:signal", {
      toUserId: bobJoined.userId,
      description: { type: "offer", sdp: "fake-offer" }
    });
    await waitForCount(signalEvents, 1);
    assert.equal(signalEvents[0].from.userId, aliceJoined.userId);
    assert.equal(signalEvents[0].description.type, "offer");

    aliceSocket.disconnect();
    bobSocket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});

test("busy target rejects second caller and hangup clears busy state", async () => {
  const chatServer = await startTestServer();

  try {
    const { socket: aliceSocket, joined: aliceJoined } = await registerAndConnect(chatServer, "alice");
    const { socket: bobSocket, joined: bobJoined } = await registerAndConnect(chatServer, "bob");
    const { socket: carolSocket } = await registerAndConnect(chatServer, "carol");

    const bobIncomingEvents = [];
    const aliceAcceptedEvents = [];
    const bobEndedEvents = [];
    const carolBusyEvents = [];
    const carolRosterEvents = [];

    bobSocket.on("call:incoming", (payload) => bobIncomingEvents.push(payload));
    aliceSocket.on("call:accepted", (payload) => aliceAcceptedEvents.push(payload));
    bobSocket.on("call:ended", (payload) => bobEndedEvents.push(payload));
    carolSocket.on("call:busy", (payload) => carolBusyEvents.push(payload));
    carolSocket.on("roster", (payload) => carolRosterEvents.push(payload));

    aliceSocket.emit("call:invite", { toUserId: bobJoined.userId });
    await waitForCount(bobIncomingEvents, 1);
    bobSocket.emit("call:accept", { withUserId: aliceJoined.userId });
    await waitForCount(aliceAcceptedEvents, 1);

    carolSocket.emit("call:invite", { toUserId: bobJoined.userId });
    await waitForCount(carolBusyEvents, 1);
    assert.match(carolBusyEvents[0].message, /通话中/);

    aliceSocket.emit("call:hangup", { withUserId: bobJoined.userId });
    await waitForCount(bobEndedEvents, 1);
    await waitForCount(carolRosterEvents, 1);

    const latestRoster = carolRosterEvents.at(-1);
    const bobRecord = latestRoster.find((user) => user.userId === bobJoined.userId);
    assert.equal(bobRecord.busy, false);

    aliceSocket.disconnect();
    bobSocket.disconnect();
    carolSocket.disconnect();
  } finally {
    await chatServer.cleanup();
  }
});
