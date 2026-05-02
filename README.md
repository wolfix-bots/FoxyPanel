# 🦊 FoxyPanel

**Lightweight Foxy Bot loader for hosting panels (Railway, Render, Heroku, VPS).**

It connects to WhatsApp using your `SESSION_ID` and loads all commands at runtime from [FoxySource](https://github.com/wolfix-bots/FoxySource). **No command files are stored in this repo.**

---

## Quick Deploy

### 1 — Get your SESSION_ID

Run the full bot (`Webfoxy`) locally once, scan the QR code, then send `.getsession` to yourself. Copy the `FOXY_...` string.

### 2 — Get a GitHub PAT

Go to **GitHub → Settings → Developer settings → Personal access tokens (classic)**.  
Generate a token with `repo` (read) access.  
This lets the bot download commands from FoxySource at startup.

### 3 — Set environment variables

Copy `.env.example` → `.env` and fill in the required fields:

| Variable | Required | Description |
|---|---|---|
| `SESSION_ID` | ✅ | Your WhatsApp session (`FOXY_...`) |
| `GITHUB_PAT` | ✅ | GitHub token to read FoxySource |
| `BOT_NAME` | optional | Display name (default: `FOXY BOT`) |
| `PREFIX` | optional | Command prefix (default: `.`) |
| `OWNER_NUMBER` | optional | Your WhatsApp number (international, no `+`) |
| `BOT_MODE` | optional | `public` or `private` (default: `public`) |

### 4 — Run

```bash
npm install
npm start
```

---

## How It Works

1. Bot starts → checks `SESSION_ID` (exits with instructions if missing)
2. Downloads commands zip from FoxySource via GitHub API
3. Extracts and imports command files into memory
4. Handles WhatsApp messages by routing to loaded commands

## Updating Commands

Send `.update` in WhatsApp (owner only) to hot-reload all commands from FoxySource without restarting.

---

## Files in This Repo

```
index.js             ← Main bot entry (Baileys connection + message handler)
utils/
  remoteLoader.js    ← Downloads & imports commands from FoxySource
.env.example         ← Environment variable template
package.json
Procfile
```

No `vendor/` folder. No command files. 🎉
