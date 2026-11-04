import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createStore(filePath) {
  let chain = Promise.resolve();

  function enqueue(work) {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readAll() {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.requests) return { requests: {} };
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { requests: {} };
      throw error;
    }
  }

  async function writeAll(data) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  return {
    async get(id) {
      return enqueue(async () => {
        const data = await readAll();
        return data.requests[id] ?? null;
      });
    },

    async insert(request) {
      return enqueue(async () => {
        const data = await readAll();
        if (data.requests[request.id]) {
          throw new Error(`Request ${request.id} already exists`);
        }
        data.requests[request.id] = request;
        await writeAll(data);
        return request;
      });
    },

    async mutate(id, fn) {
      return enqueue(async () => {
        const data = await readAll();
        const current = data.requests[id];
        if (!current) return null;
        const next = fn(structuredClone(current));
        data.requests[id] = next;
        await writeAll(data);
        return next;
      });
    },

    async delete(id) {
      return enqueue(async () => {
        const data = await readAll();
        delete data.requests[id];
        await writeAll(data);
      });
    },
  };
}
