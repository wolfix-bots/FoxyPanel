import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { fileURLToPath } from 'url';
import { loadCommandsRemotely } from './utils/remoteLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const SESSION_ID    = process.env.SESSION_ID?.trim();
const GITHUB_PAT    = process.env.GITHUB_PAT?.trim();
const BOT_NAME      = process.env.BOT_NAME   || 'FOXY BOT';
const PREFIX        = process.env.PREFIX      || '.';
const BOT_MODE      = process.env.BOT_MODE    || 'public';
const OWNER_NUMBER  = process.env.OWNER_NUMBER || '';

// ─── Startup checks ──────────────────────────────────────────────────────────
if (!SESSION_ID) {
    console.error(`
╭─────────────────────────────────────────╮
│  ❌  SESSION_ID is missing              │
├─────────────────────────────────────────┤
│  1. Run Webfoxy locally and scan QR     │
│  2. Send  .getsession  to yourself      │
│  3. Copy the FOXY_... string            │
│  4. Set SESSION_ID= in your .env file   │
╰─────────────────────────────────────────╯
`);
    process.exit(1);
}

if (!GITHUB_PAT) {
    console.warn('⚠️  GITHUB_PAT not set — commands will not load. Add it to .env');
}

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = pino({ level: 'info', transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } });

// ─── Session loader (FOXY_ prefix → multi-file session) ──────────────────────
async function loadSession() {
    const sessionDir = path.join(__dirname, 'auth_info_baileys');
    fs.mkdirSync(sessionDir, { recursive: true });

    if (SESSION_ID.startsWith('FOXY_')) {
        try {
            const { gunzipSync } = await import('zlib');
            const base64Part = SESSION_ID.slice(5);
            const compressed = Buffer.from(base64Part, 'base64');
            const json = gunzipSync(compressed).toString('utf8');
            const bundle = JSON.parse(json);
            for (const [filename, content] of Object.entries(bundle)) {
                fs.writeFileSync(path.join(sessionDir, filename), JSON.stringify(content));
            }
            logger.info('🔑 Session bundle loaded (FOXY_ format)');
        } catch (e) {
            logger.error(`Failed to decode FOXY_ session: ${e.message}`);
            process.exit(1);
        }
    } else {
        // Legacy single-creds format
        try {
            const credsPath = path.join(sessionDir, 'creds.json');
            const data = JSON.parse(Buffer.from(SESSION_ID, 'base64').toString('utf8'));
            fs.writeFileSync(credsPath, JSON.stringify(data, null, 2));
            logger.info('🔑 Session loaded (legacy format)');
        } catch (e) {
            logger.error(`Failed to decode session: ${e.message}`);
            process.exit(1);
        }
    }

    return await useMultiFileAuthState(sessionDir);
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = new Map();
const commandCategories = new Map();

async function reloadCommands() {
    commands.clear();
    commandCategories.clear();
    await loadCommandsRemotely(commands, commandCategories, logger);
}

// ─── Start bot ───────────────────────────────────────────────────────────────
async function startBot() {
    logger.info(`🦊 ${BOT_NAME} (FoxyPanel) starting...`);

    const { state, saveCreds } = await loadSession();
    const { version } = await fetchLatestBaileysVersion();

    await reloadCommands();

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['FoxyPanel', 'Chrome', '120.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            logger.warn('❌ WhatsApp requires QR scan but SESSION_ID is set. Session may have expired. Re-generate it.');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
                : true;
            logger.warn(`Connection closed — ${shouldReconnect ? 'reconnecting...' : 'logged out, not reconnecting.'}`);
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            logger.info(`✅ Connected as ${sock.user?.id?.split(':')[0] || 'unknown'}`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            await handleMessage(sock, msg);
        }
    });
}

// ─── Message handler ─────────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
    try {
        const chatId  = msg.key.remoteJid;
        const isGroup = chatId?.endsWith('@g.us');
        const sender  = isGroup ? msg.key.participant : msg.key.remoteJid;
        const senderNum = sender?.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
        const isOwner = OWNER_NUMBER && senderNum === OWNER_NUMBER;

        const textMsg =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';

        if (!textMsg.startsWith(PREFIX)) return;
        if (BOT_MODE === 'private' && !isOwner) return;

        const spaceIndex = textMsg.indexOf(' ');
        const commandName = (spaceIndex === -1
            ? textMsg.slice(PREFIX.length)
            : textMsg.slice(PREFIX.length, spaceIndex)
        ).toLowerCase().trim();

        const args = spaceIndex === -1 ? [] : textMsg.slice(spaceIndex + 1).trim().split(/\s+/);

        // Built-in: menu / help
        if (commandName === 'menu' || commandName === 'help') {
            await sendMenu(sock, msg, chatId);
            return;
        }

        // Built-in: update (owner only)
        if (commandName === 'update') {
            if (!isOwner) {
                await sock.sendMessage(chatId, { text: '❌ Only the owner can use this command.' }, { quoted: msg });
                return;
            }
            await sock.sendMessage(chatId, { text: '🔄 Reloading commands from FoxySource...' }, { quoted: msg });
            await reloadCommands();
            await sock.sendMessage(chatId, { text: `✅ Commands reloaded — ${commands.size} loaded.` }, { quoted: msg });
            return;
        }

        const command = commands.get(commandName);
        if (!command) return;

        const extra = { isOwner, isGroup, sender, senderNum, chatId, commands, commandCategories, PREFIX, BOT_NAME, BOT_MODE };
        await command.execute(sock, msg, args, PREFIX, extra);
    } catch (e) {
        logger.warn(`Message handler error: ${e.message}`);
    }
}

// ─── Menu builder ─────────────────────────────────────────────────────────────
async function sendMenu(sock, msg, chatId) {
    const catEmoji = {
        ai: '🤖', downloader: '⬇️', group: '👥', owner: '👑',
        tools: '🔧', fun: '🎉', games: '🎲', search: '🔍',
        automation: '⚡', general: '📋', media: '🖼️'
    };

    const sorted = [...commandCategories.entries()].sort(([a], [b]) => a.localeCompare(b));
    const totalCmds = commands.size;
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    let menu = `╭━━━━━━━━━━━━━━━━━━━━━╮\n┃  🦊 *${BOT_NAME}*\n╰━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
    menu += `⚡ *Prefix* » \`${PREFIX}\`\n`;
    menu += `🌐 *Mode* » ${BOT_MODE === 'public' ? '🟢 Public' : '🔴 Private'}\n`;
    menu += `📦 *Commands* » ${totalCmds}\n`;
    menu += `🕐 *Time* » ${time}\n\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const [cat, cmds] of sorted) {
        const emoji = catEmoji[cat.toLowerCase()] || '📌';
        const unique = [...new Set(cmds)].sort();
        menu += `╭─「 ${emoji} *${cat.toUpperCase()}* 」\n`;
        for (let i = 0; i < unique.length; i += 4) {
            menu += `│ ${unique.slice(i, i + 4).map(c => `\`${PREFIX}${c}\``).join('  ')}\n`;
        }
        menu += `╰──────────────────\n\n`;
    }

    menu += `> 💡 _Reply with \`${PREFIX}help <cmd>\` for details_`;
    await sock.sendMessage(chatId, { text: menu }, { quoted: msg });
}

startBot().catch(e => { logger.error(e.message); process.exit(1); });
