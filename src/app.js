import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { App } from "@slack/bolt";
import { createStore } from "./store.js";
import {
  advance,
  cancel,
  cancelFormView,
  createRequest,
  messagesFor,
  moveFormView,
  newRequestId,
  parseCancelSubmission,
  parseMoveSubmission,
  TransitionError,
} from "./workflow.js";

loadEnv();

const destChannelId = process.env.NIGHTSHIFT_CHANNEL_ID || "";
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
      view: moveFormView({ originChannelId: body.channel_id }),
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
    const originChannelId = metadata.originChannelId;
    const nightshift = destChannelId || originChannelId;
    const request = createRequest({
      id: newRequestId(),
      what: parsed.what,
      where: parsed.where,
      pocId: parsed.pocId,
      fileIds: parsed.fileIds,
      requesterId: body.user.id,
      originChannelId,
      destChannelId: nightshift,
    });

    await store.insert(request);
    try {
      const pictures = await pictureLinks(client, parsed.fileIds);
      const withPictures =
        pictures.length > 0
          ? await store.mutate(request.id, (current) => ({ ...current, pictures }))
          : request;
      await publish(client, withPictures ?? request);
    } catch (error) {
      await store.delete(request.id);
      await client.chat.postEphemeral({
        channel: originChannelId,
        user: body.user.id,
        text: "Could not post the move request. Invite @Move Request to #nightshift-inventory-requests and try /move again.",
      });
      console.error(error);
    }
  });

  app.action("move_accept", (args) => handleAdvance("accept", args));
  app.action("move_stage", (args) => handleAdvance("stage", args));
  app.action("move_load", (args) => handleAdvance("load", args));

  app.action("move_cancel", async ({ ack, body, client }) => {
    await ack();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: cancelFormView(body.actions[0].value),
    });
  });

  app.view("move_cancel_submit", async ({ ack, body, view, client }) => {
    const parsed = parseCancelSubmission(view.state.values);
    if (Object.keys(parsed.errors).length > 0) {
      await ack({ response_action: "errors", errors: parsed.errors });
      return;
    }
    await ack();

    const requestId = view.private_metadata;
    try {
      const updated = await store.mutate(requestId, (current) =>
        cancel(current, body.user.id, parsed.reason),
      );
      if (!updated) return;
      await publish(client, updated);
    } catch (error) {
      if (error instanceof TransitionError) {
        const current = await store.get(requestId);
        if (current) {
          await publish(client, current);
          await notify(
            client,
            current.originChannelId,
            body.user.id,
            "That request was already finished, so it was not cancelled.",
          );
        }
        return;
      }
      throw error;
    }
  });

  return app;
}

async function handleAdvance(action, { ack, body, client }) {
  await ack();
  const requestId = body.actions[0].value;
  const userId = body.user.id;
  try {
    const updated = await store.mutate(requestId, (current) => advance(current, action, userId));
    if (!updated) {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: "That move request is no longer available.",
      });
      return;
    }
    await publish(client, updated);
  } catch (error) {
    if (error instanceof TransitionError) {
      const current = await store.get(requestId);
      if (current) await publish(client, current);
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: userId,
        text: "That button was already used. The request message is up to date.",
      });
      return;
    }
    throw error;
  }
}

export async function publish(client, request) {
  const views = messagesFor(request);
  let destMessageTs = request.destMessageTs;
  if (destMessageTs) {
    await client.chat.update({
      channel: request.destChannelId,
      ts: destMessageTs,
      text: views.dest.text,
      blocks: views.dest.blocks,
    });
  } else {
    const posted = await client.chat.postMessage({
      channel: request.destChannelId,
      text: views.dest.text,
      blocks: views.dest.blocks,
    });
    destMessageTs = posted.ts;
  }

  let originMessageTs = request.originMessageTs;
  if (views.origin && request.originChannelId !== request.destChannelId) {
    if (originMessageTs) {
      await client.chat.update({
        channel: request.originChannelId,
        ts: originMessageTs,
        text: views.origin.text,
        blocks: views.origin.blocks,
      });
    } else {
      const posted = await client.chat.postMessage({
        channel: request.originChannelId,
        text: views.origin.text,
        blocks: views.origin.blocks,
      });
      originMessageTs = posted.ts;
    }
  }

  if (destMessageTs === request.destMessageTs && originMessageTs === request.originMessageTs) {
    return request;
  }
  return store.mutate(request.id, (current) => ({
    ...current,
    destMessageTs,
    originMessageTs,
  }));
}

async function pictureLinks(client, fileIds) {
  const links = [];
  for (const fileId of fileIds) {
    try {
      const info = await client.files.info({ file: fileId });
      if (info.file?.permalink) links.push(info.file.permalink);
    } catch (error) {
      console.error(`Could not read file ${fileId}`, error);
    }
  }
  return links;
}

async function notify(client, channel, user, text) {
  if (!channel) return;
  await client.chat.postEphemeral({ channel, user, text });
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
  console.log("Move Request bot is running. Type /move in Slack.");
}
