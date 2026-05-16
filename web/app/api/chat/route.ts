import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { MCP_TOOLS, dispatchTool } from "@/lib/sim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the robot-sim agent. You operate a Gazebo robot simulation running on Nosana's decentralized GPU network.

You have these tools:
- launch_sim: spin up a new sim on a Nosana GPU. Returns a job ID and a live noVNC URL. The container needs 2–5 minutes to fully boot.
- get_sim_status: check the state of an existing sim (QUEUED / RUNNING / etc).
- probe_sim: check whether the sim's web service is actually serving yet.
- get_sim_logs: read live logs (gz-install.log, vnc.log, novnc.log, gazebo.log, env.log, xauth.log).
- stop_sim: stop a running sim.

When the user says things like "launch sim", "start the robot", "spin one up": call launch_sim.
When they ask "is it ready", "what's the status": call get_sim_status and probe_sim.
When they ask about errors, crashes, logs: call get_sim_logs.

Be concise. After launching, surface the job ID and VNC URL clearly. Don't speculate about what's in the sim — call tools to find out.`;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
};

const openaiTools = MCP_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
  },
}));

export async function POST(req: NextRequest) {
  if (!process.env.QWEN_API_KEY) {
    return NextResponse.json(
      { error: "QWEN_API_KEY not set" },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const userMessages: ChatMessage[] = body.messages ?? [];

  const client = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL:
      process.env.QWEN_BASE_URL ??
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });
  const model = process.env.QWEN_MODEL ?? "qwen-plus";

  const convo: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...userMessages,
  ];

  const toolTrace: { name: string; args: unknown; result: unknown }[] = [];

  try {
    for (let i = 0; i < 6; i++) {
      const resp = await client.chat.completions.create({
        model,
        messages: convo as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: openaiTools,
        tool_choice: "auto",
      });

      const msg = resp.choices[0].message;
      convo.push(msg as ChatMessage);

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return NextResponse.json({
          reply: msg.content ?? "",
          toolTrace,
          finishReason: resp.choices[0].finish_reason,
        });
      }

      for (const call of calls) {
        if (call.type !== "function") continue;
        const fn = call.function;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(fn.arguments || "{}");
        } catch {}
        let result: unknown;
        try {
          result = await dispatchTool(fn.name, parsedArgs);
        } catch (e) {
          result = { error: (e as Error).message };
        }
        toolTrace.push({ name: fn.name, args: parsedArgs, result });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          name: fn.name,
          content: JSON.stringify(result),
        });
      }
    }
    return NextResponse.json({
      reply: "(stopped after 6 tool-call iterations)",
      toolTrace,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
