# MT5 Momentum Dashboard — Project Documentation

This project streams live MT5 dashboard data to a website in real time.  
The pipeline is: **MT5 EA → DLL → Node.js Server → SSE → Browser**.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Server Setup](#server-setup)
3. [DLL Placement](#dll-placement)
4. [MT5 EA Setup](#mt5-ea-setup)
5. [Ports Reference](#ports-reference)
6. [Running Locally vs Online](#running-locally-vs-online)
7. [Quick Start Checklist](#quick-start-checklist)

---

## Architecture Overview

```
MT5 Terminal
  └── EA (MQL5)
        └── DLL (mt5WebServerLiveDll.dll)
              └── WebSocket (WS/WSS) ──► Node.js server (server.js)
                                                └── SSE /stream ──► Website / Browser
```

- **MT5 EA** computes the momentum scores and calls the DLL on every candle close (or tick).
- **DLL** maintains a persistent WebSocket connection to the Node.js server.
- **Node.js server** receives the data and broadcasts it to all connected browsers via Server-Sent Events (SSE).
- **Browser** connects to `/stream` and renders the live dashboard table.

---

## Server Setup

### Apps to Install

| App | Purpose | Download |
|-----|---------|----------|
| Node.js (LTS) | Runs the server | https://nodejs.org |
| Git | Version control / deployment | https://git-scm.com/download/win |
| cloudflared *(local mode only)* | Exposes local server to internet | https://github.com/cloudflare/cloudflared/releases |

---

### Step 1 — Install Node.js

Download and install the **LTS** version from https://nodejs.org using all default options.

Verify installation by opening **Command Prompt** and running:

```cmd
node --version
npm --version
```

Both should print version numbers. If either fails, restart your machine and try again.

---

### Step 2 — Create the project folder

```cmd
mkdir C:\MT5Bridge
cd C:\MT5Bridge
```

Copy `server.js` into `C:\MT5Bridge\`.

---

### Step 3 — Install dependencies

```cmd
cd C:\MT5Bridge
npm init -y
npm install ws
```

This creates `package.json` and downloads the WebSocket library into `node_modules\`.

---

### Step 4 — Run the server

```cmd
node server.js
```

You should see:

```
╔══════════════════════════════════════════════════╗
║         MT5 Dashboard Bridge — RUNNING           ║
╠══════════════════════════════════════════════════╣
║  WS  (MT5 DLL)  →  ws://127.0.0.1:8443/ws
║  SSE (website)  →  http://127.0.0.1:8443/stream
║  Health         →  http://127.0.0.1:8443/health
╚══════════════════════════════════════════════════╝
```

> **Important:** Keep this terminal window open. Closing it stops the server.

---

### Step 5 — Verify the server is running

Open your browser and navigate to:

```
http://127.0.0.1:8443/health
```

Expected response:

```json
{"status":"ok","mt5Clients":0,"sseClients":0,"snapshots":0}
```

---

### Step 6 — Keep the server running automatically (optional but recommended)

Install PM2 to run the server as a background service that survives reboots:

```cmd
npm install -g pm2
pm2 start C:\MT5Bridge\server.js --name mt5bridge
pm2 startup
pm2 save
```

After this, the server starts automatically with Windows — no terminal needed.

To stop it:
```cmd
pm2 stop mt5bridge
```

To restart it:
```cmd
pm2 restart mt5bridge
```

---

### Step 7 — Expose server to the internet (local machine mode only)

If your Node.js server is running on your local PC and your website is hosted elsewhere, you need a tunnel so the outside world can reach your local server.

**Option A — Cloudflare Tunnel (recommended, free)**

Download `cloudflared.exe` from:
```
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
```

Place it in `C:\MT5Bridge\`, then run:

```cmd
cd C:\MT5Bridge
cloudflared tunnel --url http://localhost:8443
```

Cloudflare will print a public URL like:
```
https://some-random-words.trycloudflare.com
```

Use this URL as your server address in `dashboard.html` and MT5 EA inputs.

> **Note:** The free quick tunnel URL changes every time you restart cloudflared.  
> For a permanent URL, create a free Cloudflare account and set up a named tunnel:  
> https://developers.cloudflare.com/cloudflare-one/connections/connect-apps

**Option B — Render.com (always-online, no tunnel needed)**

If you deploy `server.js` to Render, your server is always online with a permanent URL.

1. Push your code to a GitHub repository:
```cmd
cd C:\MT5Bridge
git init
git add server.js package.json
git commit -m "mt5 bridge server"
git remote add origin https://github.com/yourusername/mt5bridge.git
git push -u origin main
```

2. Go to https://render.com → New Web Service → connect your GitHub repo.
3. Settings:
   - Environment: `Node`
   - Build command: `npm install`
   - Start command: `node server.js`
4. Render assigns a permanent URL like `https://mt5bridge.onrender.com`.

> **Important for Render:** Add this line to `server.js` so it uses Render's assigned port:
> ```javascript
> const PORT = process.env.PORT || 8443;
> ```
> Then push the update before deploying.

> **Free tier note:** Render's free tier spins down after 15 minutes of inactivity.  
> Upgrade to the $7/month plan for always-on service.

---

## DLL Placement

The compiled DLL file (`mt5WebServerLiveDll.dll`) must be placed in MT5's Libraries folder.

**How to find the Libraries folder:**

1. Open MT5
2. Go to **File → Open Data Folder**
3. Navigate to `MQL5\Libraries\`
4. Paste `mt5WebServerLiveDll.dll` here

> **Note:** MT5 must be fully closed before replacing the DLL.  
> If MT5 is open, it locks the DLL file and the new version will not load.

The DLL connects to the Node.js server via WebSocket. It is imported automatically by the EA — no manual loading required.

---

## MT5 EA Setup

### Allow DLL Imports

Before attaching the EA, DLL imports must be enabled in MT5:

1. Go to **Tools → Options → Expert Advisors**
2. Tick **Allow DLL imports**
3. Click OK

> Without this, the EA will fail to load the DLL and will not connect.

---

### Attach the EA

1. Open MetaEditor and compile the EA (`F7`)
2. In MT5, drag the EA onto any chart
3. In the EA inputs dialog, configure the connection settings (see below)
4. Tick **Allow DLL imports** in the EA dialog if prompted
5. Click OK

---

### EA Input Settings

| Input | Description |
|-------|-------------|
| `wsshost_` | The server hostname or IP address |
| `wssport_` | The port number |
| `authToken` | Authentication token (must match server config) |

---

### When to Use Which Address

| Scenario | `wsshost_` | `wssport_` |
|----------|-----------|-----------|
| Server running on the same PC as MT5 | `127.0.0.1` | `8443` |
| Server on another PC on same network | Local IP e.g. `192.168.1.10` | `8443` |
| Server via Cloudflare tunnel | e.g. `some-words.trycloudflare.com` | `443` |
| Server hosted on Render.com | e.g. `mt5bridge.onrender.com` | `443` |
| Server on a VPS with open port | VPS public IP or domain | Your chosen port |

> **Rule of thumb:**  
> - Use port `8443` when connecting directly (same machine or local network).  
> - Use port `443` when connecting through any HTTPS host (Cloudflare, Render, VPS with reverse proxy).  
> - The DLL compiled with `USE_TLS=1` supports WSS (secure WebSocket) required by HTTPS hosts.  
> - The DLL compiled with `USE_TLS=0` supports plain WS, suitable for local connections only.

---

## Ports Reference

| Port | Used For | Notes |
|------|---------|-------|
| `8443` | Local Node.js server | Default port in `server.js`. Change `const PORT = 8443` to use a different one. |
| `443` | HTTPS / WSS external hosts | Standard HTTPS port. Used when connecting to Render, Cloudflare, or any hosted server. |
| `80` | Plain HTTP | Not used in this project. |

**How ports work in this project:**

```
MT5 DLL  ──[wssport_]──►  Node.js server  ──[8443 or PORT]──►  SSE clients
```

When your server is hosted externally (Render, Cloudflare), the external host listens on port `443` and internally forwards traffic to whatever port Node.js is using. You always connect to `443` from the EA — the host handles the rest.

When running locally, both the EA and the browser connect directly to port `8443` on `127.0.0.1`.

---

## Running Locally vs Online

### Local Mode (same machine)

```
MT5 + DLL + Node.js server all on one PC
Browser opens dashboard.html by double-clicking
```

- `wsshost_` = `127.0.0.1`
- `wssport_` = `8443`
- `SSE_URL` in `dashboard.html` = `http://127.0.0.1:8443/stream`
- No tunnel needed
- Only you can see the dashboard

---

### Online Mode — Cloudflare Tunnel

```
MT5 + DLL + Node.js server on your PC
Cloudflare tunnel exposes it to the internet
Website hosted elsewhere fetches from tunnel URL
```

- `wsshost_` = `some-words.trycloudflare.com`
- `wssport_` = `443`
- `SSE_URL` in `dashboard.html` = `https://some-words.trycloudflare.com/stream`
- DLL must be compiled with `USE_TLS=1`
- URL changes on every cloudflared restart (use named tunnel for permanent URL)

---

### Online Mode — Render.com

```
Node.js server hosted permanently on Render
MT5 + DLL on your PC, connects to Render over internet
Website fetches from Render URL
```

- `wsshost_` = `mt5bridge.onrender.com`
- `wssport_` = `443`
- `SSE_URL` in `dashboard.html` = `https://mt5bridge.onrender.com/stream`
- DLL must be compiled with `USE_TLS=1`
- Server is always online (paid plan) or sleeps after 15min (free plan)

---

## Quick Start Checklist

### Every time you start

- [ ] Run `node server.js` in `C:\MT5Bridge\` (or confirm PM2 has it running)
- [ ] If using Cloudflare tunnel: run `cloudflared tunnel --url http://localhost:8443`
- [ ] Open MT5 and confirm the EA is attached to a chart
- [ ] Check `http://127.0.0.1:8443/health` — `mt5Clients` should be `1`
- [ ] Open `dashboard.html` in browser — data should appear within seconds

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `mt5Clients: 0` on health check | EA not connected | Check EA inputs, confirm DLL is in Libraries folder |
| `BridgeInit failed: resolve` | Wrong hostname in `wsshost_` | Remove `https://` — use hostname only |
| `BridgeInit failed: handshake declined` | Plain WS DLL connecting to HTTPS host | Use TLS-compiled DLL (`USE_TLS=1`) |
| `BridgeInit failed: certificate verify` | Double handshake bug in DLL code | Ensure `tls.handshake()` is called only once |
| Dashboard shows "Connecting…" forever | Wrong `SSE_URL` in `dashboard.html` | Update URL to match current server address |
| `/stream` loads forever via Cloudflare | Cloudflare buffering SSE | Ensure `X-Accel-Buffering: no` header is set in `server.js` |
| Server stops after 15 minutes on Render | Free tier spin-down | Upgrade to paid plan or use Cloudflare tunnel instead |

---

## Dashboard HTML Setup

The `dashboard.html` file is the browser-side of the pipeline. It connects to the Node.js server via SSE and renders the live table.

---

### SSE_URL — Which Address to Use

Open `dashboard.html` in any text editor and find this line near the bottom inside the `<script>` block:

```javascript
const SSE_URL = "http://127.0.0.1:8443/stream";
```

Change it depending on where your server is running:

| Scenario | `SSE_URL` value |
|----------|----------------|
| Local — server and browser on same PC | `http://127.0.0.1:8443/stream` |
| Cloudflare tunnel | `https://your-words.trycloudflare.com/stream` |
| Render.com | `https://mt5bridge.onrender.com/stream` |
| VPS with domain | `https://yourdomain.com/stream` |

> **Tip:** If you want one file that works both locally and on your hosted website without editing the URL each time, use this auto-detection pattern:
> ```javascript
> const SSE_URL = location.protocol === "file:"
>   ? "http://127.0.0.1:8443/stream"            // double-clicked locally
>   : "https://mt5bridge.onrender.com/stream";   // served from website
> ```

---

### Key Filtering — Multiple Tables from Multiple EAs

Every JSON frame sent by an EA contains a `key` field that identifies which EA sent it. This is set automatically in the EA's `tojson()` function using `__FILE__` (the EA's filename).

Example JSON frame arriving at the browser:

```json
{
  "key": "Ammar_Momentum_Dashboard.mq5",
  "src": "Ammar_Momentum_Dashboard.mq5_EURUSD_PERIOD_H1",
  "symbols": [ ... ]
}
```

When you run multiple EAs, each sends its own `key`. Each HTML page or table only renders data whose `key` matches — everything else is ignored.

---

### Single Table — Filter by Key

```javascript
const SSE_URL = "https://mt5bridge.onrender.com/stream";

// Must exactly match the EA's __FILE__ value in MT5
const MY_KEY = "Ammar_Momentum_Dashboard.mq5";

const es = new EventSource(SSE_URL);

es.onmessage = (event) => {
  const data = JSON.parse(event.data);

  // Drop frames from other EAs
  if (data.key !== MY_KEY) return;

  // Process only the data meant for this table
  data.symbols.forEach(sym => {
    console.log(sym.pair, sym.sum);
    // update your table rows here
  });
};
```

---

### Multiple Tables on One Page

One SSE connection handles all EAs — filter per table by key:

```javascript
const es = new EventSource(SSE_URL);

es.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.key === "Ammar_Momentum_Dashboard.mq5") {
    renderMomentumTable(data.symbols);
  }

  if (data.key === "Ammar_Breakout_Scanner.mq5") {
    renderBreakoutTable(data.symbols);
  }

  // add more blocks as you add more EAs
};
```

---

### How to Find Your EA's Exact Key Value

The `key` value must match exactly — including capitalisation and the `.mq5` extension.

**Method 1 — Read the raw stream:**
Open your browser and go to:
```
https://mt5bridge.onrender.com/stream
```
Watch the lines starting with `data:` — the `"key"` field is right at the start of each JSON object. Copy it exactly.

**Method 2 — Check MT5 journal:**
The EA prints its key indirectly via the `src` field. Look at the journal in MT5 after attaching the EA — the source label printed confirms the filename.

**Method 3 — Check the health endpoint:**
```
https://mt5bridge.onrender.com/health
```
The `snapshots` count tells you how many distinct EA keys the server currently holds.

> **Rule:** One EA = one key = one table. If you rename an EA file, its key changes and your HTML filter must be updated to match.
