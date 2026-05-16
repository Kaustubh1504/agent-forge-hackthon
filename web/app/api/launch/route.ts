import { NextRequest, NextResponse } from "next/server";
import { Client } from "@nosana/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { computeJobUrls } from "@/lib/nosana";

const JOB_SPEC_PATH = path.resolve(
  process.cwd(),
  "..",
  "nosana",
  "gazebo-job.json",
);
const DEFAULT_MARKET = process.env.NOSANA_MARKET ?? "nvidia-3060";
const DEFAULT_TIMEOUT_MIN = Number(process.env.NOSANA_TIMEOUT_MIN ?? "30");
const BACKEND_URL = "https://dashboard.k8s.prd.nos.ci";

async function resolveMarketAddress(slug: string): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/api/markets/${slug}/`);
  if (!r.ok) throw new Error(`Failed to resolve market '${slug}' (${r.status})`);
  const m = await r.json();
  if (!m.address) throw new Error(`Market '${slug}' has no address`);
  return m.address as string;
}

export async function POST(req: NextRequest) {
  if (!process.env.NOSANA_API_KEY) {
    return NextResponse.json(
      { error: "NOSANA_API_KEY not set in environment" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const marketSlug: string = body.market ?? DEFAULT_MARKET;
  const timeoutMin: number = Number(body.timeout ?? DEFAULT_TIMEOUT_MIN);
  const timeoutSec = timeoutMin * 60;

  try {
    const jobJson = JSON.parse(await fs.readFile(JOB_SPEC_PATH, "utf-8"));

    const nosana = new Client("mainnet", undefined, {
      apiKey: process.env.NOSANA_API_KEY,
    });

    const ipfsHash = await nosana.ipfs.pin(jobJson);
    const marketAddress = await resolveMarketAddress(marketSlug);

    const res = await nosana.api.jobs.list({
      ipfsHash,
      timeout: timeoutSec,
      market: marketAddress,
    });

    const serviceUrls = computeJobUrls(jobJson, res.job);

    return NextResponse.json({
      job: res.job,
      tx: res.tx,
      ipfsHash,
      market: { slug: marketSlug, address: marketAddress },
      timeoutSec,
      service_urls: serviceUrls,
      service_url: serviceUrls[0],
    });
  } catch (err) {
    const e = err as Error & { error?: unknown };
    return NextResponse.json(
      { error: e.message ?? "unknown error", detail: e.error },
      { status: 500 },
    );
  }
}
