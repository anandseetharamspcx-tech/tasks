export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.code = "INVALID_TRANSITION";
  }
}

const BUTTONS = {
  accept: { text: "Accept", actionId: "move_accept", style: "primary" },
  staged: { text: "Staged", actionId: "move_stage", style: "primary" },
  loaded: { text: "Loaded", actionId: "move_load", style: "primary" },
  cancel: { text: "Cancel", actionId: "move_cancel", style: "danger" },
};

export function createRequest(input) {
  const what = requiredText(input.what, "what");
  const where = requiredText(input.where, "where");
  const pocId = requiredText(input.pocId, "poc");
  const requesterId = requiredText(input.requesterId, "requester");
  const originChannelId = requiredText(input.originChannelId, "origin channel");
  const destChannelId = requiredText(input.destChannelId, "destination channel");

  return {
    id: input.id,
    what,
    where,
    pocId,
    pictures: input.pictures ?? [],
    fileIds: input.fileIds ?? [],
    requesterId,
    originChannelId,
    destChannelId,
    status: "requested",
    cancelReason: null,
    cancelledFrom: null,
    acceptedBy: null,
    stagedBy: null,
    loadedBy: null,
    cancelledBy: null,
    destMessageTs: null,
    originMessageTs: null,
  };
}

export function advance(request, action, userId) {
  const rules = {
    accept: { from: "requested", to: "accepted", by: "acceptedBy" },
    stage: { from: "accepted", to: "staged", by: "stagedBy" },
    load: { from: "staged", to: "loaded", by: "loadedBy" },
  };
  const rule = rules[action];
  if (!rule) throw new TransitionError(`Unknown action ${action}`);
  if (request.status !== rule.from) {
    throw new TransitionError(`Cannot ${action} a request that is ${request.status}`);
  }
  return { ...request, status: rule.to, [rule.by]: userId };
}

export function cancel(request, userId, reason) {
  if (request.status === "loaded" || request.status === "cancelled") {
    throw new TransitionError(`Cannot cancel a request that is ${request.status}`);
  }
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason) throw new TransitionError("A reason is required");
  return {
    ...request,
    status: "cancelled",
    cancelledFrom: request.status,
    cancelledBy: userId,
    cancelReason: cleanReason,
  };
}

export function parseMoveSubmission(values) {
  const what = values.what?.what?.value?.trim() ?? "";
  const where = values.where?.where?.value?.trim() ?? "";
  const pocId = values.poc?.poc?.selected_user ?? "";
  const files = values.pictures?.pictures?.files ?? [];
  const errors = {};
  if (!what) errors.what = "Tell us what needs to be staged";
  if (!where) errors.where = "Tell us where this is going";
  if (!pocId) errors.poc = "Pick the delivery POC";
  return {
    what,
    where,
    pocId,
    fileIds: files.map((file) => file.id).filter(Boolean),
    errors,
  };
}

export function parseCancelSubmission(values) {
  const reason = values.reason?.reason?.value?.trim() ?? "";
  const errors = {};
  if (!reason) errors.reason = "A reason is required";
  return { reason, errors };
}

export function moveFormView({ originChannelId }) {
  return {
    type: "modal",
    callback_id: "move_submit",
    private_metadata: JSON.stringify({ originChannelId }),
    title: { type: "plain_text", text: "Move request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      inputBlock("what", "What do you need to be staged?", {
        type: "plain_text_input",
        action_id: "what",
        multiline: true,
      }),
      inputBlock("where", "Where is this going?", {
        type: "plain_text_input",
        action_id: "where",
      }),
      inputBlock("poc", "Who is the POC for delivery of the items?", {
        type: "users_select",
        action_id: "poc",
        placeholder: { type: "plain_text", text: "Select a person" },
      }),
      inputBlock(
        "pictures",
        "Add pictures",
        {
          type: "file_input",
          action_id: "pictures",
          filetypes: ["png", "jpg", "jpeg", "gif", "webp", "heic"],
          max_files: 5,
        },
        { optional: true },
      ),
    ],
  };
}

export function cancelFormView(requestId) {
  return {
    type: "modal",
    callback_id: "move_cancel_submit",
    private_metadata: requestId,
    title: { type: "plain_text", text: "Cancel this move" },
    submit: { type: "plain_text", text: "Cancel request" },
    close: { type: "plain_text", text: "Back" },
    blocks: [
      inputBlock("reason", "Why are we canceling?", {
        type: "plain_text_input",
        action_id: "reason",
        multiline: true,
      }),
    ],
  };
}

export function messagesFor(request) {
  const sameChannel = request.originChannelId === request.destChannelId;
  const dest = render(request, sameChannel ? "single" : "dest");
  if (sameChannel) return { dest, origin: null };
  if (request.status === "requested" || request.status === "accepted") {
    return { dest, origin: null };
  }
  return { dest, origin: render(request, "origin") };
}

export function newRequestId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `MR-${body}`;
}

function render(request, place) {
  const lines = [headline(request, place), "", `*Where:* ${request.where}`, `*POC:* <@${request.pocId}>`];
  if (request.pictures.length > 0) {
    lines.push(`*Pictures:* ${request.pictures.map((link) => `<${link}|photo>`).join("  ")}`);
  }
  lines.push(`*Request:* ${request.id}`);
  const text = lines.join("\n");
  const blocks = [{ type: "section", text: { type: "mrkdwn", text } }];
  const buttons = buttonsFor(request, place);
  if (buttons.length > 0) {
    blocks.push({
      type: "actions",
      block_id: "move_actions",
      elements: buttons.map((button) => ({
        type: "button",
        style: button.style,
        action_id: button.actionId,
        value: request.id,
        text: { type: "plain_text", text: button.text, emoji: true },
      })),
    });
  }
  return { text: plainText(request), blocks };
}

function headline(request, place) {
  if (request.status === "cancelled") return cancelHeadline(request);
  if (request.status === "loaded") {
    return `*"${request.what}" has been loaded and sent.*\nLoaded by <@${request.loadedBy}>.`;
  }
  if (request.status === "staged") {
    if (place === "dest") {
      return `*Staging for "${request.what}" completed.*\n<@${request.stagedBy}> marked it staged.`;
    }
    return `*Staging for "${request.what}" completed.*\n<@${request.stagedBy}> hit *Loaded* once the items are loaded and sent.`;
  }
  if (request.status === "accepted") {
    return `*Move request to staging accepted by <@${request.acceptedBy}>*\nStaging of "${request.what}" is in progress. Hit *Staged* once staging is completed.`;
  }
  return `*<@${request.requesterId}> requested to move "${request.what}" to be staged for delivery.*`;
}

function cancelHeadline(request) {
  const reason = `Cancelled by <@${request.cancelledBy}>\n*Reason:* ${request.cancelReason}`;
  if (request.cancelledFrom === "accepted") {
    return `*Move request cancelled during staging.*\n"${request.what}" was accepted but will not be staged.\n${reason}`;
  }
  if (request.cancelledFrom === "staged") {
    return `*Move request cancelled after staging.*\n"${request.what}" was staged but will not be loaded and sent.\n${reason}`;
  }
  return `*Move request cancelled.*\n"${request.what}" will not be staged.\n${reason}`;
}

function buttonsFor(request, place) {
  if (request.status === "requested" && place !== "origin") return [BUTTONS.accept, BUTTONS.cancel];
  if (request.status === "accepted" && place !== "origin") return [BUTTONS.staged, BUTTONS.cancel];
  if (request.status === "staged" && place !== "dest") return [BUTTONS.loaded, BUTTONS.cancel];
  return [];
}

function plainText(request) {
  if (request.status === "cancelled") return `Move request ${request.id} cancelled`;
  if (request.status === "loaded") return `${request.what} has been loaded and sent`;
  if (request.status === "staged") return `Staging for ${request.what} completed`;
  if (request.status === "accepted") return `Move request ${request.id} accepted`;
  return `Move request ${request.id}: ${request.what}`;
}

function inputBlock(blockId, label, element, { optional = false } = {}) {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: { type: "plain_text", text: label },
    element,
  };
}

function requiredText(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TransitionError(`${name} is required`);
  }
  return value.trim();
}
