#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Client,
  getExposeIdHash,
  getExposePorts,
  isOpExposed,
} from "@nosana/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load NOSANA_API_KEY from web/.env.local if not already in env
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const FRP = "node.k8s.prd.nos.ci";
const BACKEND = "https://dashboard.k8s.prd.nos.ci";

const SPEC_PATH = path.join(__dirname, "..", "..", "nosana", "gazebo-job.json");

function readSpec() {
  return JSON.parse(fs.readFileSync(SPEC_PATH, "utf-8"));
}

function nosana() {
  const apiKey = process.env.NOSANA_API_KEY;
  if (!apiKey) throw new Error("NOSANA_API_KEY not set");
  return new Client("mainnet", undefined, { apiKey });
}

async function resolveMarket(slug) {
  const r = await fetch(`${BACKEND}/api/markets/${slug}/`);
  if (!r.ok) throw new Error(`Failed to resolve market '${slug}' (${r.status})`);
  const m = await r.json();
  if (!m.address) throw new Error(`Market '${slug}' has no address`);
  return m.address;
}

function computeUrls(flow, jobId) {
  const urls = [];
  flow.ops.forEach((op, index) => {
    if (!isOpExposed(op)) return;
    for (const port of getExposePorts(op)) {
      urls.push(`https://${getExposeIdHash(jobId, index, port.port)}.${FRP}`);
    }
  });
  return urls;
}

async function launchSim({ market = "nvidia-3060", timeoutMinutes = 30 } = {}) {
  const nos = nosana();
  const spec = readSpec();
  const timeoutSec = Number(timeoutMinutes) * 60;
  const ipfsHash = await nos.ipfs.pin(spec);
  const marketAddress = await resolveMarket(market);
  const res = await nos.api.jobs.list({
    ipfsHash,
    timeout: timeoutSec,
    market: marketAddress,
  });
  const urls = computeUrls(spec, res.job);
  return {
    jobId: res.job,
    tx: res.tx,
    market,
    timeoutMinutes,
    vncUrl: urls[0]
      ? `${urls[0]}/vnc.html?autoconnect=true&resize=remote&password=ubuntu`
      : null,
    logsUrl: urls[1] ?? null,
    note: "Image pull + apt-install + VNC startup typically takes 2–5 min on a fresh worker.",
  };
}

async function getSimStatus({ jobId }) {
  if (!jobId) throw new Error("jobId is required");
  const nos = nosana();
  const data = await nos.api.jobs.get(jobId);
  const stateLabel =
    { 0: "QUEUED", 1: "RUNNING", 2: "COMPLETED", 3: "STOPPED" }[data.state] ??
    "UNKNOWN";
  const urls =
    data.jobDefinition && Array.isArray(data.jobDefinition.ops)
      ? computeUrls(data.jobDefinition, jobId)
      : [];
  return {
    jobId,
    state: data.state,
    stateLabel,
    elapsedSec: data.timeStart
      ? Math.floor(Date.now() / 1000 - data.timeStart)
      : null,
    node: data.node,
    market: data.market,
    image: data.jobDefinition?.ops?.[0]?.args?.image,
    vncUrl: urls[0]
      ? `${urls[0]}/vnc.html?autoconnect=true&resize=remote&password=ubuntu`
      : null,
    logsUrl: urls[1] ?? null,
  };
}

async function stopSim({ jobId }) {
  if (!jobId) throw new Error("jobId is required");
  const nos = nosana();
  await nos.api.jobs.stop({ jobAddress: jobId });
  return { stopped: jobId };
}

async function getSimLogs({ jobId, file = "gazebo.log", tail = 80 }) {
  if (!jobId) throw new Error("jobId is required");
  const status = await getSimStatus({ jobId });
  if (!status.logsUrl) return { file, content: "logs server not available yet" };
  const r = await fetch(
    `${status.logsUrl}/${encodeURIComponent(file)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) return { file, content: `<not available yet: HTTP ${r.status}>` };
  const text = await r.text();
  const lines = text.split("\n");
  return {
    file,
    content: lines.slice(-Number(tail)).join("\n"),
    totalLines: lines.length,
  };
}

async function probeSim({ jobId }) {
  if (!jobId) throw new Error("jobId is required");
  const status = await getSimStatus({ jobId });
  if (!status.vncUrl) return { vnc: { ok: false, reason: "no url yet" } };
  const base = status.vncUrl.split("/vnc.html")[0];
  try {
    const r = await fetch(base, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    return {
      vnc: { ok: r.status >= 200 && r.status < 400, status: r.status },
    };
  } catch (e) {
    return { vnc: { ok: false, error: e.message } };
  }
}

const server = new Server(
  { name: "robot-sim", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "launch_sim",
      description:
        "Launch a Gazebo robot simulation on Nosana's decentralized GPU network. Returns the job ID and a live noVNC URL. The container takes 2–5 min to fully boot (image pull + Gazebo install + VNC startup). Use get_sim_status / probe_sim to check readiness.",
      inputSchema: {
        type: "object",
        properties: {
          market: {
            type: "string",
            description:
              "Nosana GPU market slug. Default: nvidia-3060. Other premium slugs: nvidia-3070, nvidia-3090, nvidia-4090, nvidia-h100.",
          },
          timeoutMinutes: {
            type: "number",
            description: "How long the GPU is reserved, in minutes. Default 30.",
          },
        },
      },
    },
    {
      name: "get_sim_status",
      description:
        "Get the current state of a Nosana sim job. Returns container state (QUEUED/RUNNING/COMPLETED/STOPPED), elapsed time, assigned node, and the live VNC + logs URLs.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: { jobId: { type: "string" } },
      },
    },
    {
      name: "probe_sim",
      description:
        "Probe whether the sim's noVNC HTTP service is actually serving (not just whether the container is RUNNING). Returns { vnc: { ok, status } }.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: { jobId: { type: "string" } },
      },
    },
    {
      name: "get_sim_logs",
      description:
        "Read the live container logs for a sim. Available files: gz-install.log (apt install), vnc.log (vncserver startup), novnc.log (websockify), env.log/xauth.log/xhost.log (display diagnostics), gazebo.log (the simulator). Returns the last `tail` lines.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: {
          jobId: { type: "string" },
          file: {
            type: "string",
            description:
              "Log file name. Default 'gazebo.log'. Common: 'gz-install.log', 'vnc.log', 'novnc.log', 'gazebo.log'.",
          },
          tail: {
            type: "number",
            description: "How many trailing lines to return (default 80).",
          },
        },
      },
    },
    {
      name: "stop_sim",
      description:
        "Stop a running sim and release its Nosana worker. Does not refund credits already consumed.",
      inputSchema: {
        type: "object",
        required: ["jobId"],
        properties: { jobId: { type: "string" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    switch (name) {
      case "launch_sim":
        result = await launchSim(args);
        break;
      case "get_sim_status":
        result = await getSimStatus(args);
        break;
      case "probe_sim":
        result = await probeSim(args);
        break;
      case "get_sim_logs":
        result = await getSimLogs(args);
        break;
      case "stop_sim":
        result = await stopSim(args);
        break;
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Error: ${e.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[robot-sim mcp] connected via stdio\n");
