import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  cancel,
  createRequest,
  deny,
  messageFor,
  parseDenySubmission,
  parseMoveSubmission,
  TransitionError,
} from "../src/workflow.js";

function sample() {
  return createRequest({
    id: "MR-TEST01",
    what: "1500 PUI boxes",
    requesterId: "UREQ",
    channelId: "CTEST",
  });
}

function actionIds(message) {
  const actions = message.blocks.find((block) => block.type === "actions");
  if (!actions) return [];
  return actions.elements.map((element) => element.action_id);
}

function body(message) {
  return message.blocks[0].text.text;
}

test("a new request has Accept and Deny buttons", () => {
  const message = messageFor(sample());
  assert.deepEqual(actionIds(message), ["move_accept", "move_deny"]);
  assert.match(body(message), /requested to move "1500 PUI boxes"/);
});

test("accept then staged then loaded updates the same message", () => {
  const accepted = advance(sample(), "accept", "U1");
  assert.deepEqual(actionIds(messageFor(accepted)), ["move_stage", "move_cancel"]);

  const staged = advance(accepted, "stage", "U2");
  assert.deepEqual(actionIds(messageFor(staged)), ["move_load", "move_cancel"]);
  assert.match(body(messageFor(staged)), /is staged/);

  const loaded = advance(staged, "load", "U3");
  assert.deepEqual(actionIds(messageFor(loaded)), []);
  assert.match(body(messageFor(loaded)), /has been loaded and sent/);
});

test("deny asks for a reason and ends the request", () => {
  const denied = deny(sample(), "U2", "Wrong dock");
  const message = messageFor(denied);
  assert.deepEqual(actionIds(message), []);
  assert.match(body(message), /will not be moved/);
  assert.match(body(message), /Wrong dock/);
  assert.throws(() => deny(sample(), "U2", "  "), TransitionError);
  assert.throws(() => deny(advance(sample(), "accept", "U1"), "U2", "late"), TransitionError);
});

test("cancel ends the request on the staged step and the loaded step", () => {
  const accepted = advance(sample(), "accept", "U1");
  const cancelledEarly = cancel(accepted, "U2");
  assert.equal(cancelledEarly.status, "cancelled");
  assert.match(body(messageFor(cancelledEarly)), /will not be staged/);
  assert.deepEqual(actionIds(messageFor(cancelledEarly)), []);

  const staged = advance(accepted, "stage", "U2");
  const cancelledLate = cancel(staged, "U3");
  assert.match(body(messageFor(cancelledLate)), /will not be loaded/);
  assert.deepEqual(actionIds(messageFor(cancelledLate)), []);

  assert.throws(() => cancel(sample(), "U9"), TransitionError);
  assert.throws(() => advance(sample(), "load", "U9"), TransitionError);
});

test("the form only requires what needs to be moved", () => {
  assert.equal(parseMoveSubmission({ what: { what: { value: "  boxes " } } }).what, "boxes");
  assert.ok(parseMoveSubmission({}).errors.what);
  assert.equal(parseDenySubmission({ reason: { reason: { value: " rain " } } }).reason, "rain");
  assert.ok(parseDenySubmission({}).errors.reason);
});
