import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { App } from "@slack/bolt";
import { createStore } from "./store.js";
import {
  advance,
  cancel,
  createRequest,
  deny,
  denyFormView,
  messageFor,
  moveFormView,
  newRequestId,
  parseDenySubmission,
  parseMoveSubmission,
  TransitionError,
} from "./workflow.js";

loadEnv();

const store = createStore(process.env.STORE_PATH || "./data/requests.json");

export function createApp() {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.command("/move", async ({ ack, body, client }) => {
    await ack();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: moveFormView({ channelId: body.channel_id }),
    });
  });

  app.view("move_submit", async ({ ack, body, view, client }) => {
    const parsed = parseMoveSubmission(view.state.values);
    if (Object.keys(parsed.errors).length > 0) {
      await ack({ response_action: "errors", errors: parsed.errors });
      return;
    }
    await ack();

    const metadata = JSON.parse(view.private_metadata || "{}");
    const request = createRequest({
      id: newRequestId(),
      what: parsed.what,
      requesterId: body.user.id,
      channelId: metadata.channelId,
    });

    await store.insert(request);
    try {
      await publish(client, request);
    } catch (error) {
      await store.delete(request.id);
      await client.chat.postEphemeral({
        channel: metadata.channelId,
        user: body.user.id,
        text: "Could not post the move request. Invite @Move Request to this channel and try /move again.",
      });
      console.error(error);
    }
  });

  app.action("move_accept", (args) => handleAdvance("accept", args));
  app.action("move_stage", (args) => handleAdvance("stage", args));
  app.action("move_load", (args) => handleAdvance("load", args));

  app.action("move_deny", async ({ ack, body, client }) => {
    await ack();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: denyFormView(body.actions[0].value),
    });
  });

  app.view("move_deny_submit", async ({ ack, body, view, client }) => {
    const parsed = parseDenySubmission(view.state.values);
    if (Object.keys(parsed.errors).length > 0) {
      await ack({ response_action: "errors", errors: parsed.errors });
      return;
    }
    await ack();
    await apply(client, view.private_metadata, body.user.id, (current) =>
      deny(current, body.user.id, parsed.reason),
    );
  });

  app.action("move_cancel", async ({ ack, body, client }) => {
    await ack();
    await apply(client, body.actions[0].value, body.user.id, (current) =>
      cancel(current, body.user.id),
    );
  });

  return app;
}

async function handleAdvance(action, { ack, body, client }) {
  await ack();
  await apply(client, body.actions[0].value, body.user.id, (current) =>
    advance(current, action, body.user.id),
  );
}

async function apply(client, requestId, userId, change) {
  try {
    const updated = await store.mutate(requestId, change);
    if (!updated) return;
    await publish(client, updated);
  } catch (error) {
    if (!(error instanceof TransitionError)) throw error;
    const current = await store.get(requestId);
    if (!current) return;
    await publish(client, current);
    await client.chat.postEphemeral({
      channel: current.channelId,
      user: userId,
      text: "That button was already used. The request is up to date.",
    });
  }
}

export async function publish(client, request) {
  const view = messageFor(request);
  if (request.messageTs) {
    await client.chat.update({
      channel: request.channelId,
      ts: request.messageTs,
      text: view.text,
      blocks: view.blocks,
    });
    return request;
  }
  const posted = await client.chat.postMessage({
    channel: request.channelId,
    text: view.text,
    blocks: view.blocks,
  });
  return store.mutate(request.id, (current) => ({
    ...current,
    messageTs: posted.ts,
  }));
}

function loadEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const app = createApp();
  await app.start();
  console.log("Move Request bot is running. Type /move in #testing-bot-stuff.");
}
