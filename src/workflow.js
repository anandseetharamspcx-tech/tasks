export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.code = "INVALID_TRANSITION";
  }
}

const BUTTONS = {
  accept: { text: "Accept", actionId: "move_accept", style: "primary" },
  deny: { text: "Deny", actionId: "move_deny", style: "danger" },
  staged: { text: "Staged", actionId: "move_stage", style: "primary" },
  loaded: { text: "Loaded", actionId: "move_load", style: "primary" },
  cancel: { text: "Cancel", actionId: "move_cancel", style: "danger" },
};

export function createRequest(input) {
  return {
    id: input.id,
    what: requiredText(input.what, "what"),
    requesterId: requiredText(input.requesterId, "requester"),
    channelId: requiredText(input.channelId, "channel"),
    status: "requested",
    denyReason: null,
    deniedBy: null,
    cancelledFrom: null,
    cancelledBy: null,
    acceptedBy: null,
    stagedBy: null,
    loadedBy: null,
    messageTs: null,
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

export function deny(request, userId, reason) {
  if (request.status !== "requested") {
    throw new TransitionError(`Cannot deny a request that is ${request.status}`);
  }
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason) throw new TransitionError("A reason is required");
  return {
    ...request,
    status: "denied",
    deniedBy: userId,
    denyReason: cleanReason,
  };
}

export function cancel(request, userId) {
  if (request.status !== "accepted" && request.status !== "staged") {
    throw new TransitionError(`Cannot cancel a request that is ${request.status}`);
  }
  return {
    ...request,
    status: "cancelled",
    cancelledFrom: request.status,
    cancelledBy: userId,
  };
}

export function parseMoveSubmission(values) {
  const what = values.what?.what?.value?.trim() ?? "";
  const errors = {};
  if (!what) errors.what = "Say what needs to be moved";
  return { what, errors };
}

export function parseDenySubmission(values) {
  const reason = values.reason?.reason?.value?.trim() ?? "";
  const errors = {};
  if (!reason) errors.reason = "A reason is required";
  return { reason, errors };
}

export function moveFormView({ channelId }) {
  return {
    type: "modal",
    callback_id: "move_submit",
    private_metadata: JSON.stringify({ channelId }),
    title: { type: "plain_text", text: "Move request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      inputBlock("what", "What needs to be moved?", {
        type: "plain_text_input",
        action_id: "what",
        multiline: true,
      }),
    ],
  };
}

export function denyFormView(requestId) {
  return {
    type: "modal",
    callback_id: "move_deny_submit",
    private_metadata: requestId,
    title: { type: "plain_text", text: "Deny this move" },
    submit: { type: "plain_text", text: "Deny" },
    close: { type: "plain_text", text: "Back" },
    blocks: [
      inputBlock("reason", "Why are you denying this?", {
        type: "plain_text_input",
        action_id: "reason",
        multiline: true,
      }),
    ],
  };
}

export function messageFor(request) {
  const text = [headline(request), "", `*Request:* ${request.id}`].join("\n");
  const blocks = [{ type: "section", text: { type: "mrkdwn", text } }];
  const buttons = buttonsFor(request);
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

export function newRequestId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `MR-${body}`;
}

function headline(request) {
  if (request.status === "denied") {
    return `*Move request denied by <@${request.deniedBy}>*\n"${request.what}" will not be moved.\n*Reason:* ${request.denyReason}`;
  }
  if (request.status === "cancelled" && request.cancelledFrom === "staged") {
    return `*Move request cancelled.*\n"${request.what}" was staged but will not be loaded.\nCancelled by <@${request.cancelledBy}>.`;
  }
  if (request.status === "cancelled") {
    return `*Move request cancelled.*\n"${request.what}" was accepted but will not be staged.\nCancelled by <@${request.cancelledBy}>.`;
  }
  if (request.status === "loaded") {
    return `*"${request.what}" has been loaded and sent.*\nLoaded by <@${request.loadedBy}>.`;
  }
  if (request.status === "staged") {
    return `*"${request.what}" is staged.*\nMarked staged by <@${request.stagedBy}>.`;
  }
  if (request.status === "accepted") {
    return `*Move request accepted by <@${request.acceptedBy}>*\n"${request.what}" is waiting to be staged.`;
  }
  return `*<@${request.requesterId}> requested to move "${request.what}".*`;
}

function buttonsFor(request) {
  if (request.status === "requested") return [BUTTONS.accept, BUTTONS.deny];
  if (request.status === "accepted") return [BUTTONS.staged, BUTTONS.cancel];
  if (request.status === "staged") return [BUTTONS.loaded, BUTTONS.cancel];
  return [];
}

function plainText(request) {
  if (request.status === "denied") return `Move request ${request.id} denied`;
  if (request.status === "cancelled") return `Move request ${request.id} cancelled`;
  if (request.status === "loaded") return `${request.what} has been loaded and sent`;
  if (request.status === "staged") return `${request.what} is staged`;
  if (request.status === "accepted") return `Move request ${request.id} accepted`;
  return `Move request ${request.id}: ${request.what}`;
}

function inputBlock(blockId, label, element) {
  return {
    type: "input",
    block_id: blockId,
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
