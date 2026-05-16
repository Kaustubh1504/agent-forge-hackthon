import { NextRequest, NextResponse } from "next/server";
import { Client } from "@nosana/sdk";
import { computeJobUrls } from "@/lib/nosana";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!process.env.NOSANA_API_KEY) {
    return NextResponse.json(
      { error: "NOSANA_API_KEY not set in environment" },
      { status: 500 },
    );
  }

  try {
    const nosana = new Client("mainnet", undefined, {
      apiKey: process.env.NOSANA_API_KEY,
    });
    const data = (await nosana.api.jobs.get(id)) as {
      jobDefinition?: { ops?: unknown[] };
      [k: string]: unknown;
    };

    let service_urls: string[] = [];
    if (data.jobDefinition && Array.isArray(data.jobDefinition.ops)) {
      try {
        service_urls = computeJobUrls(
          data.jobDefinition as { ops: never[] },
          id,
        );
      } catch {}
    }

    return NextResponse.json({
      ...data,
      service_urls,
      service_url: service_urls[0],
    });
  } catch (err) {
    const e = err as Error & { error?: unknown };
    return NextResponse.json(
      { error: e.message ?? "unknown error", detail: e.error },
      { status: 500 },
    );
  }
}
