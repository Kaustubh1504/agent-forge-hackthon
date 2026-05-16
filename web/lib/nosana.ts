import { getExposeIdHash, getExposePorts, isOpExposed } from "@nosana/sdk";

export const FRP_SERVER_ADDR = "node.k8s.prd.nos.ci";

type Op = { type?: string; id?: string; args?: { expose?: unknown } };
type JobFlow = { ops: Op[] };

export function computeJobUrls(flow: JobFlow, jobId: string): string[] {
  const urls: string[] = [];
  flow.ops.forEach((op, index) => {
    if (!isOpExposed(op)) return;
    const ports = getExposePorts(op);
    ports.forEach((port: { port: number }) => {
      const exposeId = getExposeIdHash(jobId, index, port.port);
      urls.push(`https://${exposeId}.${FRP_SERVER_ADDR}`);
    });
  });
  return urls;
}
