import { getExposeIdHash, getExposePorts, isOpExposed } from "@nosana/sdk";

export const FRP_SERVER_ADDR = "node.k8s.prd.nos.ci";

type LooseOp = { args?: { expose?: unknown } };
type JobFlow = { ops: LooseOp[] };

export function computeJobUrls(flow: JobFlow, jobId: string): string[] {
  const urls: string[] = [];
  flow.ops.forEach((op, index) => {
    // SDK helpers expect the strict Operation<"container/run"> shape;
    // cast since at runtime they only inspect `args`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = op as any;
    if (!isOpExposed(o)) return;
    const ports = getExposePorts(o) as { port: number }[];
    ports.forEach((port) => {
      const exposeId = getExposeIdHash(jobId, index, port.port);
      urls.push(`https://${exposeId}.${FRP_SERVER_ADDR}`);
    });
  });
  return urls;
}
