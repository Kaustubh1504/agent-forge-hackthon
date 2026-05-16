import { NextRequest, NextResponse } from "next/server";
import { Client } from "@nosana/sdk";

export async function POST(
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
    const data = await nosana.api.jobs.stop({ jobAddress: id });
    return NextResponse.json(data);
  } catch (err) {
    const e = err as Error & { error?: unknown };
    return NextResponse.json(
      { error: e.message ?? "unknown error", detail: e.error },
      { status: 500 },
    );
  }
}
