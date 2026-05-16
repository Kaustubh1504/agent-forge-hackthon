import {
  Client,
  getExposeIdHash,
  getExposePorts,
  isOpExposed,
} from "@nosana/sdk";

const FRP = "node.k8s.prd.nos.ci";
const BACKEND = "https://dashboard.k8s.prd.nos.ci";

// Embedded so it ships with the build and the deployable container needs no
// extra files alongside it.
export const GAZEBO_JOB_SPEC = {
  version: "0.1",
  type: "container",
  meta: {
    trigger: "webapp",
    system_requirements: { required_vram: 4 },
  },
  ops: [
    {
      type: "container/run",
      id: "sim",
      args: {
        image: "docker.io/tiryoh/ros2-desktop-vnc:humble",
        gpu: true,
        expose: [80, 8080],
        entrypoint: ["/bin/bash", "-c"],
        cmd: [
          "set -x; mkdir -p /var/log/sim /root/.vnc; (cd /var/log/sim && python3 -m http.server 8080) >/dev/null 2>&1 & echo '--- install start' > /var/log/sim/gz-install.log; apt-get update -qq >> /var/log/sim/gz-install.log 2>&1 && apt-get install -y --no-install-recommends ignition-fortress x11-xserver-utils >> /var/log/sim/gz-install.log 2>&1 && echo '--- install done' >> /var/log/sim/gz-install.log && echo 'ubuntu' | vncpasswd -f > /root/.vnc/passwd && chmod 600 /root/.vnc/passwd && printf '#!/bin/sh\\nexport HOME=/root\\nexport DISPLAY=:1\\nexport XAUTHORITY=/root/.Xauthority\\nenv > /var/log/sim/env.log\\nxauth list > /var/log/sim/xauth.log 2>&1\\nxhost + > /var/log/sim/xhost.log 2>&1\\nxsetroot -solid \"#2e3440\" > /var/log/sim/xsetroot.log 2>&1\\nsleep 2\\nLIBGL_ALWAYS_SOFTWARE=1 ign gazebo -r -v 4 diff_drive.sdf > /var/log/sim/gazebo.log 2>&1\\n' > /root/.vnc/xstartup && chmod +x /root/.vnc/xstartup && rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 && echo '--- starting vncserver' > /var/log/sim/vnc.log && vncserver :1 -geometry 1600x900 -depth 24 -SecurityTypes VncAuth -localhost no >> /var/log/sim/vnc.log 2>&1 && sleep 3 && echo '--- starting websockify' > /var/log/sim/novnc.log && websockify --web=/usr/lib/novnc 80 localhost:5901 >> /var/log/sim/novnc.log 2>&1",
        ],
      },
    },
  ],
} as const;

const STATE_LABEL: Record<number, string> = {
  0: "QUEUED",
  1: "RUNNING",
  2: "COMPLETED",
  3: "STOPPED",
};

function nosana() {
  const apiKey = process.env.NOSANA_API_KEY;
  if (!apiKey) throw new Error("NOSANA_API_KEY not set");
  return new Client("mainnet", undefined, { apiKey });
}

async function resolveMarket(slug: string): Promise<string> {
  const r = await fetch(`${BACKEND}/api/markets/${slug}/`);
  if (!r.ok) throw new Error(`Failed to resolve market '${slug}' (${r.status})`);
  const m = await r.json();
  if (!m.address) throw new Error(`Market '${slug}' has no address`);
  return m.address as string;
}

type JobFlow = { ops: { args?: { expose?: unknown } }[] };

export function computeJobUrls(flow: JobFlow, jobId: string): string[] {
  const urls: string[] = [];
  flow.ops.forEach((op, index) => {
    if (!isOpExposed(op)) return;
    for (const port of getExposePorts(op) as { port: number }[]) {
      urls.push(`https://${getExposeIdHash(jobId, index, port.port)}.${FRP}`);
    }
  });
  return urls;
}

function withAutoconnect(baseVnc: string | undefined): string | undefined {
  return baseVnc
    ? `${baseVnc}/vnc.html?autoconnect=true&resize=remote&password=ubuntu`
    : undefined;
}

export async function launchSim(
  args: { market?: string; timeoutMinutes?: number } = {},
) {
  const nos = nosana();
  const market = args.market ?? "nvidia-3060";
  const timeoutMinutes = Number(args.timeoutMinutes ?? 30);
  const timeoutSec = timeoutMinutes * 60;
  const ipfsHash = await nos.ipfs.pin(GAZEBO_JOB_SPEC);
  const marketAddress = await resolveMarket(market);
  const res = await nos.api.jobs.list({
    ipfsHash,
    timeout: timeoutSec,
    market: marketAddress,
  });
  const urls = computeJobUrls(GAZEBO_JOB_SPEC as JobFlow, res.job);
  return {
    jobId: res.job,
    tx: res.tx,
    market,
    timeoutMinutes,
    vncUrl: withAutoconnect(urls[0]),
    logsUrl: urls[1] ?? null,
    note: "Image pull + apt install + VNC startup takes 2–5 min on a fresh worker.",
  };
}

export async function getSimStatus(args: { jobId: string }) {
  if (!args.jobId) throw new Error("jobId is required");
  const nos = nosana();
  const data = (await nos.api.jobs.get(args.jobId)) as {
    state?: number;
    timeStart?: number;
    node?: string;
    market?: string;
    jobDefinition?: { ops?: { args?: { image?: string } }[] };
  };
  const urls =
    data.jobDefinition && Array.isArray(data.jobDefinition.ops)
      ? computeJobUrls(data.jobDefinition as JobFlow, args.jobId)
      : [];
  return {
    jobId: args.jobId,
    state: data.state,
    stateLabel:
      data.state !== undefined ? (STATE_LABEL[data.state] ?? "UNKNOWN") : null,
    elapsedSec: data.timeStart
      ? Math.floor(Date.now() / 1000 - data.timeStart)
      : null,
    node: data.node,
    market: data.market,
    image: data.jobDefinition?.ops?.[0]?.args?.image,
    vncUrl: withAutoconnect(urls[0]),
    logsUrl: urls[1] ?? null,
  };
}

export async function stopSim(args: { jobId: string }) {
  if (!args.jobId) throw new Error("jobId is required");
  const nos = nosana();
  await nos.api.jobs.stop({ jobAddress: args.jobId });
  return { stopped: args.jobId };
}

export async function probeSim(args: { jobId: string }) {
  const status = await getSimStatus(args);
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
    return { vnc: { ok: false, error: (e as Error).message } };
  }
}

export async function getSimLogs(args: {
  jobId: string;
  file?: string;
  tail?: number;
}) {
  if (!args.jobId) throw new Error("jobId is required");
  const file = args.file ?? "gazebo.log";
  const tail = Number(args.tail ?? 80);
  const status = await getSimStatus({ jobId: args.jobId });
  if (!status.logsUrl)
    return { file, content: "logs server not available yet", totalLines: 0 };
  const r = await fetch(
    `${status.logsUrl}/${encodeURIComponent(file)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok)
    return { file, content: `<not available yet: HTTP ${r.status}>`, totalLines: 0 };
  const text = await r.text();
  const lines = text.split("\n");
  return {
    file,
    content: lines.slice(-tail).join("\n"),
    totalLines: lines.length,
  };
}

export const MCP_TOOLS = [
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
      "Probe whether the sim's noVNC HTTP service is actually serving (not just whether the container is RUNNING).",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string" } },
    },
  },
  {
    name: "get_sim_logs",
    description:
      "Read the live container logs. Files: gz-install.log, vnc.log, novnc.log, env.log, xauth.log, xhost.log, gazebo.log. Returns the last `tail` lines.",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string" },
        file: { type: "string" },
        tail: { type: "number" },
      },
    },
  },
  {
    name: "stop_sim",
    description: "Stop a running sim and release its Nosana worker.",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string" } },
    },
  },
] as const;

export async function dispatchTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "launch_sim":
      return launchSim(args as { market?: string; timeoutMinutes?: number });
    case "get_sim_status":
      return getSimStatus(args as { jobId: string });
    case "probe_sim":
      return probeSim(args as { jobId: string });
    case "get_sim_logs":
      return getSimLogs(args as { jobId: string; file?: string; tail?: number });
    case "stop_sim":
      return stopSim(args as { jobId: string });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
