// server.js
// Receives WebSocket frames from MT5 DLL → broadcasts to website via SSE
//
// INSTALL & RUN:
//   npm init -y
//   npm install ws
//   node server.js

const http               = require("http");
const { WebSocketServer } = require("ws");

// ── Config ────────────────────────────────────────────────────────────────────
//const PORT         = 8443;
const PORT = process.env.PORT || 8443;
const HEARTBEAT_MS = 5000;
// ─────────────────────────────────────────────────────────────────────────────

const latestSnapshot = new Map();
const sseClients     = new Set();

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {

  if (req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type":                "text/event-stream",
      "Cache-Control":               "no-cache",
      "Connection":                  "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering":           "no",        // disables Cloudflare/nginx buffering
    });
    res.write(": connected\n\n");

    // Send cached snapshot immediately so page isn't blank on load
    for (const [, snapshot] of latestSnapshot) {
      res.write(`data: ${snapshot}\n\n`);
    }

    sseClients.add(res);
    console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

    // Keep-alive ping every 15s — prevents Cloudflare closing idle SSE connections
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
      mt5Clients: wss.clients.size,
      sseClients: sseClients.size,
      snapshots:  latestSnapshot.size,
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket, req) => {
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
    // No per-message log — intentional
  });

  socket.on("close", (code, reason) => {
    console.log(`[WS] MT5 disconnected. code=${code} reason=${reason || "none"}`);
  });

  socket.on("error", (err) => {
    console.error("[WS] Error:", err.message);
  });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      console.warn("[WS] Dead socket detected, terminating.");
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);

wss.on("close", () => clearInterval(heartbeat));

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         MT5 Dashboard Bridge — RUNNING           ║
╠══════════════════════════════════════════════════╣
║  WS  (MT5 DLL)  →  ws://127.0.0.1:${PORT}/ws
║  SSE (website)  →  http://127.0.0.1:${PORT}/stream
║  Health         →  http://127.0.0.1:${PORT}/health
╚══════════════════════════════════════════════════╝
  `);
});

process.on("SIGINT",  () => { console.log("\nShutting down..."); httpServer.close(); process.exit(0); });
process.on("SIGTERM", () => { console.log("\nShutting down..."); httpServer.close(); process.exit(0); });