import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../.cmd_cache');
const GITHUB_API = 'https://api.github.com';

const SOURCE_OWNER = 'wolfix-bots';
const SOURCE_REPO  = 'FoxySource';
const _t = ['ghp_DgyfIa48', 'WNEo4q3lgRFn', 'GM5ib1eFN406xUa4'];
const GITHUB_TOKEN = _t.join('');

export async function loadCommandsRemotely(commands, commandCategories, logger) {
    const token = GITHUB_TOKEN;

    logger.info(`📦 Fetching commands from ${SOURCE_OWNER}/${SOURCE_REPO}...`);

    // Download the repo zip via GitHub API
    const zipUrl = `${GITHUB_API}/repos/${SOURCE_OWNER}/${SOURCE_REPO}/zipball/main`;
    const zipRes = await fetch(zipUrl, {
        headers: {
            Authorization: `token ${token}`,
            'User-Agent': 'foxy-panel',
            Accept: 'application/vnd.github+json',
        },
        redirect: 'follow',
    });

    if (!zipRes.ok) {
        logger.error(`❌ Failed to fetch FoxySource: ${zipRes.status} ${zipRes.statusText}`);
        return 0;
    }

    const buf = Buffer.from(await zipRes.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    // Wipe previous cache
    if (fs.existsSync(CACHE_DIR)) fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // Extract all command .js files from commands/** 
    const writes = [];
    zip.forEach((relPath, file) => {
        // relPath: "wolfix-bots-FoxySource-<sha>/commands/ai/gemini.js"
        const match = relPath.match(/^[^/]+\/(commands\/.+\.js)$/);
        if (!match || file.dir) return;
        const localRel = match[1]; // e.g. commands/ai/gemini.js
        const dest = path.join(CACHE_DIR, localRel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        writes.push(file.async('nodebuffer').then(data => fs.writeFileSync(dest, data)));
    });
    await Promise.all(writes);

    // Import every extracted .js file
    let loaded = 0;
    const categoryAliases = {
        'tool': 'tools', 'utility': 'tools', 'utilities': 'tools', 'system': 'tools',
        'download': 'downloader', 'game': 'games',
        'status': 'automation', 'stalk': 'search', 'scripture': 'search',
        'creative': 'fun', 'settings': 'owner', 'admin': 'owner',
    };

    const walk = (dir) => {
        for (const item of fs.readdirSync(dir)) {
            const full = path.join(dir, item);
            if (fs.statSync(full).isDirectory()) { walk(full); continue; }
            if (!item.endsWith('.js')) continue;

            // Use the immediate parent folder as fallback category
            const folderCategory = path.basename(path.dirname(full));

            try {
                // Bust Node's module cache by adding a timestamp query
                const fileUrl = `file://${full}?t=${Date.now()}`;
                writes.push(
                    import(fileUrl).then(mod => {
                        const command = mod.default || mod;
                        if (!command?.name) return;
                        const rawCat = (command.category || folderCategory).toLowerCase().trim();
                        const cat = categoryAliases[rawCat] || rawCat;
                        command.category = cat;
                        const key = command.name.toLowerCase();
                        commands.set(key, command);
                        if (!commandCategories.has(cat)) commandCategories.set(cat, []);
                        const list = commandCategories.get(cat);
                        if (!list.includes(command.name)) list.push(command.name);
                        if (Array.isArray(command.alias)) {
                            command.alias.forEach(a => commands.set(a.toLowerCase(), command));
                        }
                        loaded++;
                    }).catch(e => logger.warn(`skip ${item}: ${e.message}`))
                );
            } catch(e) { logger.warn(`skip ${item}: ${e.message}`); }
        }
    };

    walk(CACHE_DIR);
    await Promise.all(writes);

    logger.info(`✅ Remote commands loaded: ${loaded}`);
    return loaded;
}
