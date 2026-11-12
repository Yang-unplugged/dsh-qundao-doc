import fs from 'node:fs';
import { restoreBackup } from './store.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) { console.error('Usage: node server/restore.mjs backup.json EMPTY_DESTINATION'); process.exitCode = 1; }
else { try { console.log(restoreBackup(JSON.parse(fs.readFileSync(source, 'utf8')), destination)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
