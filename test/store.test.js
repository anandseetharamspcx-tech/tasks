import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStore } from "../src/store.js";
import { advance, createRequest } from "../src/workflow.js";

test("store remembers a request across a new store instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "move-request-"));
  try {
    const filePath = join(dir, "nested", "requests.json");
    const store = createStore(filePath);
    const request = createRequest({
      id: "MR-STORE1",
      what: "cones",
      requesterId: "UREQ",
      channelId: "C1",
    });
    await store.insert(request);
    const updated = await store.mutate("MR-STORE1", (current) => advance(current, "accept", "UACCEPT"));
    assert.equal(updated.status, "accepted");

    const reopened = createStore(filePath);
    const saved = await reopened.get("MR-STORE1");
    assert.equal(saved.acceptedBy, "UACCEPT");
    assert.equal(await reopened.get("missing"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed update does not save", async () => {
  const dir = await mkdtemp(join(tmpdir(), "move-request-"));
  try {
    const store = createStore(join(dir, "requests.json"));
    await store.insert(
      createRequest({
        id: "MR-STORE2",
        what: "cones",
        requesterId: "UREQ",
        channelId: "C1",
      }),
    );
    await assert.rejects(() => store.mutate("MR-STORE2", () => {
      throw new Error("nope");
    }));
    const saved = await store.get("MR-STORE2");
    assert.equal(saved.status, "requested");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
