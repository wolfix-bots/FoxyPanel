# 🦊 Foxy Bot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) with commands across multiple categories — AI, downloads, games, tools, search, and more.

---

## Commands

Use `.menu` to browse all commands. Default prefix is `.`

| Category | Description |
|---|---|
| 🤖 AI | Chat, image generation, video analysis, vision, deep reasoning |
| 🔍 Search | Web search, Wikipedia, social lookup, scripture |
| 🎮 Games | Trivia, word games, fun interactive commands |
| 📥 Downloader | YouTube, TikTok, Instagram, and more |
| 🛠️ Tools | Converters, calculators, utilities |
| 🎨 Fun | Fonts, memes, creative tools |
| ⚙️ Automation | Auto-react, status tools |
| 👑 Owner | Bot management, reload, settings |

```
.menu              → All commands grouped by category
.menu ai           → Only AI commands
.help <command>    → Help for a specific command
```

---

## Features

- **AI suite** — Llama, DeepSeek R1, NVIDIA Nemotron reasoning, SDXL image generation, native video + vision analysis
- **Media downloads** — YouTube audio/video, TikTok, Instagram Reels
- **Search tools** — Web search, Wikipedia, social stalk
- **Hot reload** — `.update` (owner only) refreshes all commands without restarting the bot
- **Session-based auth** — Connects via a `FOXY_...` session string, no QR scan needed on deploy
- **Public/private mode** — Control who can use the bot via `BOT_MODE`
