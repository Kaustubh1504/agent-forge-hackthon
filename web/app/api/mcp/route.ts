import { NextRequest, NextResponse } from "next/server";
import { MCP_TOOLS, dispatchTool } from "@/lib/sim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const SERVER_INFO = {
  name: "robot-sim",
  version: "0.1.0",
};

function ok(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function err(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, data },
  });
}

function checkAuth(req: NextRequest): boolean {
  const required = process.env.MCP_API_KEY;
  if (!required) return true;
  const got =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.nextUrl.searchParams.get("api_key");
  return got === required;
}

async function handle(body: JsonRpcRequest): Promise<NextResponse> {
  const { id, method, params } = body;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "tools/list") {
    return ok(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    if (!name) return err(id, -32602, "missing tool name");
    try {
      const result = await dispatchTool(name, args);
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (e) {
      return ok(id, {
        content: [
          { type: "text", text: `Error: ${(e as Error).message}` },
        ],
        isError: true,
      });
    }
  }

  if (method === "ping") {
    return ok(id, {});
  }

  return err(id, -32601, `method not found: ${method}`);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
      { status: 401 },
    );
  }
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return err(null, -32700, "parse error");
  }
  // Notifications (no id) get no response in JSON-RPC; we 204.
  if (body.id === undefined && body.method?.startsWith("notifications/")) {
    return new NextResponse(null, { status: 204 });
  }
  return handle(body);
}

export async function GET() {
  return NextResponse.json({
    server: SERVER_INFO,
    tools: MCP_TOOLS.map((t) => t.name),
    transport: "http-jsonrpc",
    note: "POST JSON-RPC 2.0 requests here. Methods: initialize, tools/list, tools/call.",
  });
}
