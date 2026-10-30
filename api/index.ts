// The whole API behind one serverless function. Boots once per instance and reuses the
// connection pool and clients across requests.
import { boot } from "../agent/src/context.js";

let booted: ReturnType<typeof boot> | null = null;

async function handle(request: Request): Promise<Response> {
  booted ??= boot().catch((err) => {
    booted = null;
    throw err;
  });
  const { app } = await booted;
  return app.fetch(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
