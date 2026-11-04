# Move Request bot

Button bot for #testing-bot-stuff. People type `/move`, and the request is one message whose buttons change. Nobody advances it by replying in the thread.

1. `/move` asks what needs to be moved and posts the request in that channel.
2. **Accept** or **Deny**. Deny asks for a reason and ends the request.
3. **Staged** or **Cancel**. Cancel ends the request.
4. **Loaded** or **Cancel**. Cancel ends the request. Loaded finishes it.

## One-time setup

Slack has to install the app before it can put buttons in the channel. This repo cannot invite itself.

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → paste `slack-manifest.json`.
2. Turn on **Socket Mode** and create an app-level token with the `connections:write` scope.
3. Install the app to the workspace and copy the bot token.
4. Invite **@Move Request** to #testing-bot-stuff.
5. Copy `.env.example` to `.env` and fill in both tokens.
6. Start it and leave it running:

```bash
npm install
npm test
npm start
```

Then type `/move` in #testing-bot-stuff.
