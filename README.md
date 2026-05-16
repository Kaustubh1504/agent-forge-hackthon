# Robot Sim on Demand

**Voice-driven Gazebo robot simulations on decentralized GPUs.**

### 🚀 **[Live demo → https://agent-forge-hackthon.vercel.app](https://agent-forge-hackthon.vercel.app/)**

**Web MCP endpoint:** `https://agent-forge-hackthon.vercel.app/api/mcp`

One natural-language command → a fresh GPU pod on Nosana → live Gazebo + noVNC streaming back into your browser, in ~2 minutes.

> *"Launch sim on Nosana"* → Qwen agent → MCP tool → Nosana GPU → Gazebo → live VNC iframe + log feed.

Built for the **Agent Forge Hackathon**.

---

## What it does

- **Webapp** at `/` — status cards, live VNC of the running robot, log stream, plus a built-in chat + 🎙 mic
- **Agent** at `/api/chat` — Qwen (`qwen3.6-plus`) reads natural language and decides which tool to call
- **Web MCP** at `/api/mcp` — JSON-RPC endpoint exposing 5 tools (`launch_sim`, `get_sim_status`, `probe_sim`, `get_sim_logs`, `stop_sim`) — usable by Claude Desktop, Claude Code, or any MCP client
- **REST** at `/api/launch`, `/api/status/:id`, `/api/stop/:id`, `/api/probe`, `/api/logs/:id` — same actions, programmable from anything
- **Nosana sim** — `tiryoh/ros2-desktop-vnc:humble` base + `apt install ignition-fortress` + a minimal `xstartup` that auto-runs `ign gazebo -r diff_drive.sdf`
- **Logs** — a tiny `python3 -m http.server` on a second exposed port serves `/var/log/sim/*.log` so the page can tail install / vncserver / Gazebo output live

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│  ├─ Mic / Web Speech API ──► text                          │
│  └─ Chat input ──────────────►                             │
│                              POST /api/chat                │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│  Next.js app (web/)                                        │
│  /api/chat   → Qwen (qwen3.6-plus, OpenAI-compatible API)  │
│             → tool calls → dispatchTool() (lib/sim.ts)     │
│  /api/mcp    → JSON-RPC web MCP (same dispatch table)      │
│  /api/launch /status /stop /probe /logs → REST surface     │
└──────────────────────────┬─────────────────────────────────┘
                           │ Nosana SDK
┌──────────────────────────▼─────────────────────────────────┐
│  Nosana mainnet  →  GPU worker  →  container               │
│  ├─ port 80   noVNC (Gazebo visible in browser)            │
│  └─ port 8080 logs server (gz-install / vnc / gazebo logs) │
└────────────────────────────────────────────────────────────┘
```

---

## Sponsor / partner stack — and where each plugs in

| Partner | Role in this build |
|---|---|
| **Nosana** | Core: dynamic GPU pod for the Gazebo simulator (premium `nvidia-3060` market, paid via API key credits). Hands-off via the `@nosana/sdk`. |
| **Qwen Cloud** (`qwen3.6-plus`) | The agent brain — reads natural language from the chat / mic, picks which MCP tool to call. OpenAI-compatible endpoint. |
| **Anthropic MCP** (open protocol) | Tool-server contract. `/api/mcp` is a JSON-RPC web MCP usable by Claude Desktop / Claude Code / any client. `web/mcp/index.mjs` is the stdio variant for local Claude Code. |
| **Zeabur** | One-click deploy for the whole Next.js app — UI + REST + MCP + chat all served from a single URL. |
| **Qoder** | Agentic coding platform used during the build — pair-programming, scaffolding the Next.js routes, and refactoring the shared `lib/sim.ts` tool layer. |
| **Z.ai (GLM family)** | Tested as an alternate frontier LLM for the agent role; swappable with Qwen via the same OpenAI-compatible interface. |
| **TokenRouter** | Smart routing layer between Qwen and Z.ai (and other models) — used for cost/latency tuning of the chat endpoint. |
| **Web Speech API** (browser-native) | Mic input → text without any cloud STT bill. |

Future-ready slots (clear path, not yet wired): **Butterbase** (Postgres + object storage for rollout datasets, auth), **AgentField** (multi-agent orchestration of sim / recorder / quality-checker), **Evermind** (cross-session memory of demo quality).

---

## Repo layout

```
hackthon/
├── README.md                — this file
├── PRESENTATION.md          — Marp slides for the demo
├── nosana/
│   └── gazebo-job.json      — Nosana job spec (bare image, runtime apt install + xstartup)
├── docker/                  — early local-dev Dockerfile (not used at runtime)
└── web/                     — the Next.js app (deployable)
    ├── app/
    │   ├── page.tsx         — UI: status cards, VNC iframe, log panel, chat + mic
    │   └── api/
    │       ├── launch/      — POST: submit Nosana job, return job + URLs
    │       ├── status/[id]/ — GET: container state + computed VNC/log URLs
    │       ├── stop/[id]/   — POST: stop a running job
    │       ├── probe/       — GET: HEAD-probe whether port 80 is serving
    │       ├── logs/[id]/   — GET: proxy fetch from container's log server
    │       ├── chat/        — POST: Qwen + tool-calling loop
    │       └── mcp/         — POST: JSON-RPC web MCP (5 tools)
    ├── lib/
    │   └── sim.ts           — single source of truth for tool implementations
    ├── mcp/
    │   └── index.mjs        — stdio MCP variant (for local Claude Code)
    └── Dockerfile           — for self-hosted Ubuntu / VPS deploy
```

---

## Run locally

```bash
cd web
cp .env.local.example .env.local      # then fill in keys (see below)
npm install
npm run dev                            # serves on http://localhost:3000
```

Required env vars (`web/.env.local`):

```bash
NOSANA_API_KEY=nos_…                  # required to launch sims
NOSANA_MARKET=nvidia-3060             # any premium Nosana GPU market slug
NOSANA_TIMEOUT_MIN=30

QWEN_API_KEY=sk-…                     # required for the chat agent
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.6-plus

# Optional: protect the public MCP endpoint
MCP_API_KEY=any-token                  # clients must send `Authorization: Bearer <token>`
```

---

## Deploy

### Zeabur (recommended)

1. Push the repo to GitHub
2. New Project → connect repo → set **Root Directory: `web`**
3. Add the env vars above in **Variables** → **Redeploy**
4. **Networking → Generate Domain** → `https://<sub>.zeabur.app`

### Self-hosted Ubuntu (Docker)

```bash
git clone <repo> && cd <repo>/web
docker build -t robot-sim-web .
docker run -d --restart unless-stopped \
  -p 3000:3000 --env-file /opt/robot-sim.env \
  --name robot-sim-web robot-sim-web
```

(Optional) put Caddy in front for auto-HTTPS:
```
:80 { reverse_proxy localhost:3000 }
```

### Self-hosted (no Docker)

```bash
cd web
rm -rf node_modules package-lock.json    # avoid platform-pinned Tailwind oxide
npm install
npm run build
pm2 start "npm start" --name robot-sim-web
```

Open inbound TCP **3000** in your cloud security group.

---

## Use the agent

### From the webapp UI
Open `/`, type or click 🎙 → say **"Launch sim on Nosana"**. The chat panel fires the tool, the launcher cards light up, and the VNC iframe appears once the container's noVNC starts serving (2–5 min).

### From Claude Code / Claude Desktop (web MCP)

```bash
claude mcp add --transport http robot-sim https://agent-forge-hackthon.vercel.app/api/mcp
```

If `MCP_API_KEY` is set, append `--header "Authorization: Bearer <token>"`. Then chat naturally:

> *"Launch a sim on Nosana, then tell me when Gazebo is up."*

### From Claude Code (stdio MCP, local-only)

Create `.mcp.json` in the repo root:
```json
{
  "mcpServers": {
    "robot-sim": {
      "type": "stdio",
      "command": "node",
      "args": ["./web/mcp/index.mjs"]
    }
  }
}
```

Restart Claude Code, approve the project MCP, done.

---

## Status

**Shipped today**

- End-to-end voice/text → Nosana GPU → Gazebo in browser
- Both stdio MCP (local) and web MCP (deployable)
- Live log streaming via secondary exposed port
- Auto-login VNC (no password prompt)
- Cross-platform Docker + Ubuntu deploy

**Next**

- **Teleop capture**: W/A/S/D and voice → `move_robot` MCP tool → publish `/cmd_vel` to the diff-drive
- **Rollout recording**: write (obs, action, reward) tuples to Butterbase as LeRobot-compatible datasets
- **Multi-robot fleet**: parallel sims, agent picks the best policy

---

## Credits

Built in one day at the Agent Forge Hackathon on top of: **Nosana** (GPU compute) · **Qwen Cloud** (LLM) · **Anthropic MCP** (protocol) · **Zeabur** (deploy) · **Qoder** (build-time coding agent) · **Z.ai** (alternate LLM) · **TokenRouter** (model routing).
