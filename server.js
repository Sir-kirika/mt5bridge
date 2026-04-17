// server.js
// Receives WebSocket frames from MT5 DLL → broadcasts to website via SSE
//
// LOCAL MODE:  WSS on port 8443 using self-signed cert (cert.pem + key.pem)
//              DLL uses USE_TLS=1, verify_none, connects to wss://127.0.0.1:8443
// RENDER MODE: Plain HTTP on process.env.PORT — Render handles TLS termination
//              DLL uses USE_TLS=1, connects to wss://mt5bridge.onrender.com:443
//
// INSTALL & RUN:
//   npm init -y
//   npm install ws
//   node server.js
//
// CERT GENERATION (local only, run once):
//   "C:\Program Files\OpenSSL-Win64\bin\openssl.exe" req -x509 -newkey rsa:2048 ^
//     -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=localhost"

const fs                 = require("fs");
const http               = require("http");
const https              = require("https");
const { WebSocketServer } = require("ws");

// ── Config ────────────────────────────────────────────────────────────────────
const IS_RENDER    = !!process.env.PORT;
const PORT         = process.env.PORT || 8443;
const HEARTBEAT_MS = 5000;
// ─────────────────────────────────────────────────────────────────────────────

const latestSnapshot = new Map();
const sseClients     = new Set();

// ── Shared request handler ────────────────────────────────────────────────────
function handleRequest(req, res) {

  if (req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type":                "text/event-stream",
      "Cache-Control":               "no-cache",
      "Connection":                  "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering":           "no",
    });
    res.write(": connected\n\n");

    for (const [, snapshot] of latestSnapshot) {
      res.write(`data: ${snapshot}\n\n`);
    }

    sseClients.add(res);
    console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

    const keepAlive = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(keepAlive); }
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:     "ok",
      mode:       IS_RENDER ? "render" : "local-wss",
      mt5Clients: wss.clients.size,
      sseClients: sseClients.size,
      snapshots:  latestSnapshot.size,
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

// ── Shared WebSocket handler ──────────────────────────────────────────────────
function handleWsConnection(socket, req) {
  console.log(`[WS] MT5 connected from ${req.socket.remoteAddress}`);

  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

  socket.on("message", (rawData) => {
    const raw = rawData.toString().trim();
    if (!raw) return;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[WS] Non-JSON frame ignored");
      return;
    }

    const key = parsed.key || parsed.src || "default";
    latestSnapshot.set(key, raw);

    parsed._serverTs = Date.now();
    const enriched = JSON.stringify(parsed);

    let dropped = 0;
    for (const client of sseClients) {
      try {
        client.write(`data: ${enriched}\n\n`);
      } catch {
        sseClients.delete(client);
        dropped++;
      }
    }

    if (dropped > 0) {
      console.warn(`[SSE] Removed ${dropped} dead client(s). Remaining: ${sseClients.size}`);
    }
  });

  socket.on("close", (code, reason) => {
    console.log(`[WS] MT5 disconnected. code=${code} reason=${reason || "none"}`);
  });

  socket.on("error", (err) => {
    console.error("[WS] Error:", err.message);
  });
}

// ── Create server — HTTPS locally, HTTP on Render ─────────────────────────────
let server;

if (IS_RENDER) {
  // Render handles TLS termination — Node just speaks plain HTTP internally
  server = http.createServer(handleRequest);
  console.log("[INFO] Running on Render — plain HTTP internally, TLS handled by Render");
} else {
  // Local — load self-signed cert and speak WSS directly
  let certOptions;
  try {
    certOptions = {
      key:  fs.readFileSync("key.pem"),
      cert: fs.readFileSync("cert.pem"),
    };
    console.log("[INFO] Loaded cert.pem and key.pem — starting WSS server");
  } catch (e) {
    console.error(`
[ERROR] Could not load cert.pem / key.pem.
Generate them first by running:

  "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe" req -x509 -newkey rsa:2048 ^
    -keyout key.pem -out cert.pem -days 3650 -nodes -subj "/CN=localhost"

Then restart the server.
    `);
    process.exit(1);
  }
  server = https.createServer(certOptions, handleRequest);
}

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on("connection", handleWsConnection);

// ── Heartbeat ─────────────────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      console.warn("[WS] Dead socket, terminating.");
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(heartbeat));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  if (IS_RENDER) {
    console.log(`
╔══════════════════════════════════════════════════╗
║      MT5 Dashboard Bridge — RENDER MODE          ║
╠══════════════════════════════════════════════════╣
║  WSS (MT5 DLL)  →  wss://[your-render-url]/ws
║  SSE (website)  →  https://[your-render-url]/stream
║  Health         →  https://[your-render-url]/health
║  Internal port  →  ${PORT}
╚══════════════════════════════════════════════════╝
    `);
  } else {
    console.log(`
╔══════════════════════════════════════════════════╗
║      MT5 Dashboard Bridge — LOCAL WSS MODE       ║
╠══════════════════════════════════════════════════╣
║  WSS (MT5 DLL)  →  wss://127.0.0.1:${PORT}
║  SSE (browser)  →  https://127.0.0.1:${PORT}/stream
║  Health         →  https://127.0.0.1:${PORT}/health
╚══════════════════════════════════════════════════╝
    `);
  }
});

process.on("SIGINT",  () => { console.log("\nShutting down..."); server.close(); process.exit(0); });
process.on("SIGTERM", () => { console.log("\nShutting down..."); server.close(); process.exit(0); });