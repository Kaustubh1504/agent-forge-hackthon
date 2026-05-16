import { NextRequest, NextResponse } from "next/server";
import { Client } from "@nosana/sdk";
import { computeJobUrls } from "@/lib/nosana";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const file = req.nextUrl.searchParams.get("file") ?? "gazebo.log";

  if (!process.env.NOSANA_API_KEY) {
    return NextResponse.json(
      { error: "NOSANA_API_KEY not set" },
      { status: 500 },
    );
  }

  try {
    const nosana = new Client("mainnet", undefined, {
      apiKey: process.env.NOSANA_API_KEY,
    });
    const data = (await nosana.api.jobs.get(id)) as {
      jobDefinition?: { ops?: unknown[] };
    };
    if (!data.jobDefinition || !Array.isArray(data.jobDefinition.ops)) {
      return NextResponse.json(
        { error: "no jobDefinition on job" },
        { status: 404 },
      );
    }
    const urls = computeJobUrls(
      data.jobDefinition as { ops: never[] },
      id,
    );
    const logsUrl = urls[1];
    if (!logsUrl) {
      return NextResponse.json(
        { error: "no second exposed port (logs)" },
        { status: 404 },
      );
    }

    const r = await fetch(`${logsUrl}/${encodeURIComponent(file)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return new NextResponse(
        `<not available yet: HTTP ${r.status}>`,
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }
    const text = await r.text();
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return new NextResponse(`<error: ${(e as Error).message}>`, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
