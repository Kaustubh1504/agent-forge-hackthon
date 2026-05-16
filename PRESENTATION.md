---
marp: true
theme: default
paginate: true
backgroundColor: "#fafafa"
style: |
  section { font-family: -apple-system, "SF Pro Text", sans-serif; padding: 60px; }
  h1 { color: #059669; }
  h2 { color: #18181b; border-bottom: 2px solid #059669; padding-bottom: 8px; }
  table { font-size: 0.85em; }
  code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; }
---

<!-- _class: lead -->

# Robot Sim on Demand

### Voice-driven Gazebo simulations on decentralized GPUs

Built with **Nosana · Qwen · MCP · Zeabur**
Team: Kaustubh · Agent Forge Hackathon

---

## The problem

- Robot training needs **GPU + simulator + data collection** — all 3 are painful to set up
- Cloud GPUs are expensive and centralized (AWS, Lambda Labs)
- Researchers waste days on infra instead of training models
- No off-the-shelf way to **let an AI agent control the whole pipeline**

> "Spin up a robot, drive it, capture demonstrations" should be one sentence — not a weekend of DevOps.

---

## Our solution

**One sentence → live robot simulation on a decentralized GPU.**

```
"Launch sim on Nosana"  ──►  Qwen agent  ──►  MCP tool
                                                 │
                                                 ▼
                                     Nosana decentralized GPU
                                     ├─ Gazebo (diff-drive robot)
                                     ├─ noVNC streaming to browser
                                     └─ live log feed
```

- **Voice or text** input in the browser
- **Qwen** picks the right tool and parameters
- **MCP** routes to the live Nosana job
- You see the **robot in your tab** in ~2 min

---

## Demo flow

1. Open the deployed webapp
2. Click 🎙 → say *"Launch sim on Nosana"*
3. Agent calls `launch_sim` → Nosana boots a GPU pod
4. Status cards: **Container** RUNNING · **Service** STARTING → READY
5. Live **Gazebo + diff-drive robot** appears in the iframe
6. Live container logs stream on the right side
7. Say *"Stop the sim"* → agent calls `stop_sim` → resources released

---

## Partner stack — where each plugs in

| Partner | What we use it for |
|---|---|
| **Nosana** | Core: dynamic GPU pod for the Gazebo simulator (`nvidia-3060` market, paid via API credits) |
| **Qwen Cloud (`qwen3.6-plus`)** | The agent brain — reads natural language, decides which MCP tool to call |
| **Anthropic MCP (open protocol)** | Tool-server contract — `/api/mcp` exposes 5 tools (`launch_sim`, `get_sim_status`, `probe_sim`, `get_sim_logs`, `stop_sim`) |
| **Zeabur** | One-click deploy of the Next.js app — UI + REST + MCP all on one URL |
| **Web Speech API** (browser-native) | Mic input → text without any cloud STT bill |

Future-ready: **Butterbase** for rollout storage, **AgentField** for multi-agent orchestration, **Evermind** for cross-session demo memory.

---

## Why it matters · what's next

**Today (shipped):**
- Voice/text → live Gazebo on Nosana GPU, end-to-end in ~2 min
- Same MCP endpoint reusable by Claude Desktop, Claude Code, any client

**Next (clear path):**
- **Teleop capture**: W/A/S/D + voice → `move_robot` MCP tool → publish `/cmd_vel`
- **Rollout recording**: save (obs, action, reward) to Butterbase as a LeRobot dataset
- **Multi-robot fleet**: parallel sims, agent compares strategies

> An open, agent-native robot training platform — built in 1 day on sponsor tech.

