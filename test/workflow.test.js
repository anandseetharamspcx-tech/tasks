import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  cancel,
  messagesFor,
  parseCancelSubmission,
  parseMoveSubmission,
  createRequest,
  TransitionError,
} from "../src/workflow.js";

function sample(overrides = {}) {
  return createRequest({
    id: "MR-TEST01",
    what: "1500 PUI boxes",
    where: "Dock 4",
    pocId: "UPOC",
    requesterId: "UREQ",
    originChannelId: "CORIGIN",
    destChannelId: "CNIGHT",
    pictures: ["https://files.slack.com/photo"],
    ...overrides,
  });
}

function actionIds(message) {
  const actions = message.blocks.find((block) => block.type === "actions");
  if (!actions) return [];
  return actions.elements.map((element) => element.action_id);
}

test("request starts with Accept and Cancel in the night shift channel", () => {
  const { dest, origin } = messagesFor(sample());
  assert.deepEqual(actionIds(dest), ["move_accept", "move_cancel"]);
  assert.equal(origin, null);
  assert.match(dest.blocks[0].text.text, /requested to move "1500 PUI boxes"/);
  assert.match(dest.blocks[0].text.text, /Dock 4/);
  assert.match(dest.blocks[0].text.text, /<@UPOC>/);
});

test("same channel keeps every button on one message", () => {
  const requested = sample({ originChannelId: "CSAME", destChannelId: "CSAME" });
  assert.deepEqual(actionIds(messagesFor(requested).dest), ["move_accept", "move_cancel"]);
  assert.equal(messagesFor(requested).origin, null);

  const staged = advance(advance(requested, "accept", "USTAGE"), "stage", "USTAGE");
  const view = messagesFor(staged);
  assert.equal(view.origin, null);
  assert.deepEqual(actionIds(view.dest), ["move_load", "move_cancel"]);
});

test("staging moves the Loaded button to the channel where /move was used", () => {
  const accepted = advance(sample(), "accept", "UACCEPT");
  const staged = advance(accepted, "stage", "USTAGE");
  const view = messagesFor(staged);
  assert.deepEqual(actionIds(view.dest), []);
  assert.match(view.dest.blocks[0].text.text, /Staging for "1500 PUI boxes" completed/);
  assert.deepEqual(actionIds(view.origin), ["move_load", "move_cancel"]);
});

test("loaded and cancelled messages have no buttons", () => {
  const loaded = advance(advance(advance(sample(), "accept", "U1"), "stage", "U2"), "load", "U3");
  const view = messagesFor(loaded);
  assert.deepEqual(actionIds(view.dest), []);
  assert.deepEqual(actionIds(view.origin), []);
  assert.match(view.origin.blocks[0].text.text, /has been loaded and sent/);

  const cancelled = cancel(advance(sample(), "accept", "U1"), "UCANCEL", "Truck broke down");
  const cancelView = messagesFor(cancelled);
  assert.deepEqual(actionIds(cancelView.dest), []);
  assert.deepEqual(actionIds(cancelView.origin), []);
  assert.match(cancelView.dest.blocks[0].text.text, /will not be staged/);
  assert.match(cancelView.dest.blocks[0].text.text, /Truck broke down/);
  assert.match(cancelView.origin.blocks[0].text.text, /Truck broke down/);
});

test("cancel copy follows the stage that was stopped", () => {
  const duringStaging = cancel(advance(sample(), "accept", "U1"), "U2", "Wrong dock");
  assert.match(messagesFor(duringStaging).dest.blocks[0].text.text, /cancelled during staging/);

  const afterStaging = cancel(
    advance(advance(sample(), "accept", "U1"), "stage", "U2"),
    "U3",
    "Site closed",
  );
  assert.match(messagesFor(afterStaging).origin.blocks[0].text.text, /will not be loaded and sent/);
});

test("buttons cannot skip or repeat a stage", () => {
  const request = sample();
  assert.throws(() => advance(request, "stage", "U1"), TransitionError);
  assert.throws(() => advance(request, "load", "U1"), TransitionError);
  const loaded = advance(advance(advance(request, "accept", "U1"), "stage", "U2"), "load", "U3");
  assert.throws(() => advance(loaded, "accept", "U4"), TransitionError);
  assert.throws(() => cancel(loaded, "U4", "too late"), TransitionError);
  assert.throws(() => cancel(request, "U4", "   "), TransitionError);
});

test("form parsing keeps the move fields and requires a cancel reason", () => {
  const parsed = parseMoveSubmission({
    what: { what: { value: "  boxes " } },
    where: { where: { value: "Dock 4" } },
    poc: { poc: { selected_user: "UPOC" } },
    pictures: { pictures: { files: [{ id: "F1" }, { id: "" }] } },
  });
  assert.deepEqual(parsed.errors, {});
  assert.equal(parsed.what, "boxes");
  assert.deepEqual(parsed.fileIds, ["F1"]);

  const missing = parseMoveSubmission({});
  assert.ok(missing.errors.what);
  assert.ok(missing.errors.where);
  assert.ok(missing.errors.poc);

  assert.equal(parseCancelSubmission({ reason: { reason: { value: "  rain " } } }).reason, "rain");
  assert.ok(parseCancelSubmission({}).errors.reason);
});
