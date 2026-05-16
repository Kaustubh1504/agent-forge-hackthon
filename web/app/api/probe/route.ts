import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { ok: false, status: 0, error: "url required" },
      { status: 400 },
    );
  }
  try {
    const r = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    return NextResponse.json({
      ok: r.status >= 200 && r.status < 400,
      status: r.status,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: 0,
      error: (e as Error).message,
    });
  }
}
