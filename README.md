# Move Request bot

Slack bot for the night-shift move request. Someone types `/move` in a channel, fills in the same form as the Workflow Builder version, and the request is one message that updates in place.

Buttons are Accept, then Staged, then Loaded. Cancel is on every one of those. Cancel asks why, posts the reason, locks the buttons, and stops the request.

Accept and Staged go to `#nightshift-inventory-requests`. Loaded goes back to the channel where `/move` was used. If you leave the night-shift channel blank, the whole request stays in the channel where `/move` was typed, which is the easy way to try it.

## Set up

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App** → **From a manifest**. Paste `slack-manifest.json`.
2. Turn on **Socket Mode** and create an app-level token with the `connections:write` scope.
3. Install the app to the workspace and copy the bot token.
4. Invite **@Move Request** to `#nightshift-inventory-requests` and to any channel where people will run `/move`.
5. Copy `.env.example` to `.env` and fill in the tokens. Put the night-shift channel ID in `NIGHTSHIFT_CHANNEL_ID` (channel name → About → copy the ID).
6. Start it:

```bash
npm install
npm test
npm start
```

The process has to stay running. Socket Mode connects out to Slack, so this can run on any machine that stays on.

Then type `/move` in the channel.
