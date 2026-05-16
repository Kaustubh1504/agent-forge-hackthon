"use client";

import { useEffect, useState } from "react";

const STATE_LABEL: Record<number, string> = {
  0: "QUEUED",
  1: "RUNNING",
  2: "COMPLETED",
  3: "STOPPED",
};

type StatusInfo = {
  state?: number;
  jobStatus?: string | null;
  timeStart?: number;
  timeout?: number;
  service_url?: string;
  service_urls?: string[];
  jobDefinition?: {
    ops?: { args?: { image?: string } }[];
  };
  [k: string]: unknown;
};

const LOG_FILES = [
  "gz-install.log",
  "vnc.log",
  "novnc.log",
  "gazebo.log",
] as const;
type LogFile = (typeof LOG_FILES)[number];

export default function Home() {
  const [launching, setLaunching] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [serviceUp, setServiceUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<LogFile>("gz-install.log");
  const [logContent, setLogContent] = useState<string>("");

  async function launch() {
    setLaunching(true);
    setError(null);
    setStatus(null);
    setServiceUp(null);
    setJobId(null);
    try {
      const r = await fetch("/api/launch", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "launch failed");
      setStatus(data);
      setJobId(data.job ?? data.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  async function stopJob() {
    if (!jobId) return;
    try {
      await fetch(`/api/stop/${jobId}`, { method: "POST" });
    } catch {}
    setJobId(null);
    setStatus(null);
    setServiceUp(null);
  }

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/status/${jobId}`);
        const data: StatusInfo = await r.json();
        if (!alive) return;
        setStatus((prev) => ({ ...prev, ...data }));
      } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId || status?.state !== 1) return;
    let alive = true;
    const fetchLog = async () => {
      try {
        const r = await fetch(
          `/api/logs/${jobId}?file=${encodeURIComponent(logFile)}`,
          { cache: "no-store" },
        );
        const text = await r.text();
        if (alive) setLogContent(text);
      } catch {}
    };
    fetchLog();
    const t = setInterval(fetchLog, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId, status?.state, logFile]);

  useEffect(() => {
    const url = status?.service_url;
    if (!url || status?.state !== 1) {
      setServiceUp(null);
      return;
    }
    let alive = true;
    const probe = async () => {
      try {
        const r = await fetch(`/api/probe?url=${encodeURIComponent(url)}`);
        const data = await r.json();
        if (alive) setServiceUp(Boolean(data.ok));
      } catch {
        if (alive) setServiceUp(false);
      }
    };
    probe();
    const t = setInterval(probe, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [status?.service_url, status?.state]);

  const stateLabel =
    status?.state !== undefined ? STATE_LABEL[status.state] : null;
  const url = status?.service_url;
  const image = status?.jobDefinition?.ops?.[0]?.args?.image;
  const elapsed = status?.timeStart
    ? Math.floor(Date.now() / 1000 - status.timeStart)
    : null;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Robot Sim Launcher
          </h1>
          <p className="text-sm text-zinc-500">
            Nosana GPU · Gazebo · noVNC
          </p>
        </header>

        <section className="flex items-center gap-3">
          <button
            onClick={launch}
            disabled={launching || (jobId !== null && status?.state === 1)}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {launching ? "Launching..." : "Launch sim on Nosana"}
          </button>
          {jobId && (
            <button
              onClick={stopJob}
              className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Stop
            </button>
          )}
        </section>

        {error && (
          <pre className="text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 p-3 rounded-md whitespace-pre-wrap">
            {error}
          </pre>
        )}

        {jobId && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatusCard
              label="Container"
              value={stateLabel ?? "—"}
              tone={
                status?.state === 1
                  ? "ok"
                  : status?.state === 0
                    ? "pending"
                    : "muted"
              }
              detail={elapsed !== null ? `${elapsed}s elapsed` : undefined}
            />
            <StatusCard
              label="Service"
              value={
                serviceUp === true
                  ? "READY"
                  : status?.state === 1
                    ? "STARTING"
                    : "—"
              }
              tone={
                serviceUp === true
                  ? "ok"
                  : status?.state === 1
                    ? "pending"
                    : "muted"
              }
              detail={
                serviceUp === false && status?.state === 1
                  ? "pulling image / starting (2–5 min)"
                  : undefined
              }
            />
            <StatusCard
              label="Image"
              value={image ? imageShort(image) : "—"}
              tone="muted"
              detail={status?.timeout ? `${status.timeout}s timeout` : undefined}
            />
          </section>
        )}

        <div className="aspect-video w-full border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden bg-black grid place-items-center">
          {serviceUp && url ? (
            <iframe src={url} className="w-full h-full" />
          ) : jobId ? (
            <div className="text-zinc-400 text-sm text-center px-6">
              {status?.state === 1
                ? "Container running on Nosana. Waiting for the noVNC service to come up..."
                : "Waiting for Nosana to schedule the container..."}
              <br />
              <code className="text-xs text-zinc-500">
                {jobId.slice(0, 12)}…
              </code>
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">
              click <b>Launch sim on Nosana</b> to start
            </div>
          )}
        </div>

        {url && (
          <p className="text-xs text-zinc-500">
            stream url:{" "}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {url}
            </a>
            {status?.service_urls?.[1] && (
              <>
                {" "}
                · logs:{" "}
                <a
                  href={status.service_urls[1]}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {status.service_urls[1]}
                </a>
              </>
            )}
          </p>
        )}

        {jobId && status?.state === 1 && (
          <section className="border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden bg-zinc-50 dark:bg-zinc-900">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                logs
              </span>
              {LOG_FILES.map((f) => (
                <button
                  key={f}
                  onClick={() => setLogFile(f)}
                  className={`text-xs px-2 py-1 rounded ${
                    logFile === f
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                      : "text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  {f}
                </button>
              ))}
              <span className="ml-auto text-xs text-zinc-400">
                refreshes every 3s
              </span>
            </div>
            <pre className="text-xs p-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-zinc-800 dark:text-zinc-200">
              {logContent || "<no output yet>"}
            </pre>
          </section>
        )}

        {status && (
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">raw job info</summary>
            <pre className="mt-2 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-md overflow-x-auto">
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}

function imageShort(s: string) {
  return s.replace(/^docker\.io\//, "").slice(0, 38);
}

function StatusCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "ok" | "pending" | "muted";
  detail?: string;
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "pending"
        ? "bg-amber-500 animate-pulse"
        : "bg-zinc-400";
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-md p-3 bg-white dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="font-mono text-sm">{value}</span>
      </div>
      {detail && (
        <div className="mt-1 text-xs text-zinc-500">{detail}</div>
      )}
    </div>
  );
}
