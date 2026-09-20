import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

// Only configured transcript locations are read; this does not expose .run
// through the file browser or make arbitrary local paths accessible.
export async function retrieveIotHistory(question: string) {
  const root = path.basename(process.cwd()) === 'web' ? path.dirname(process.cwd()) : process.cwd();
  const transcriptBase = path.resolve(process.env.SPEECH_TRANSCRIPT_PATH || path.join(root, '.run/transcripts/conversation.jsonl'));
  const directories = new Set([
    path.dirname(transcriptBase),
    path.join(root, '.run'),
    path.resolve(process.env.IOT_MEMORY_DIR || path.join(process.cwd(), '.run/iot-conversations')),
    path.join(root, '.run/iot-conversations'),
  ]);
  const ignored = new Set('a an the is are was were i my me what did do does you your about in on to of and it conversation conversations history said tell remember'.split(' '));
  const terms = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => !ignored.has(t)))];
  const hits: { path: string; title: string; excerpt: string; score: number; modified: string }[] = [];
  const seen = new Set<string>();
  function add(text: unknown, source: string, date: string, label: string) {
    if (typeof text !== 'string' || !text.trim()) return;
    const key = text.trim();
    if (seen.has(key)) return;
    seen.add(key);
    const score = terms.reduce((sum, term) => sum + (text.toLowerCase().includes(term) ? 1 : 0), 0);
    hits.push({ path: source, title: 'IoT conversation', excerpt: `${label}: ${text.slice(0, 800)}`, score, modified: date });
    hits.sort((a,b) => b.score - a.score || b.modified.localeCompare(a.modified));
    if (hits.length > 6) hits.pop();
  }
  for (const directory of directories) {
    let names: string[];
    try { names = await fs.readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names.sort().reverse()) {
      const memory = /^[a-f0-9]{64}\.json$/.test(name) && directory.endsWith('iot-conversations');
      const base = path.basename(transcriptBase, path.extname(transcriptBase));
      if (!memory && name !== 'conversation.jsonl' && !(name.startsWith(`${base}-`) && name.endsWith('.jsonl'))) continue;
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile()) continue;
      const source = path.relative(root, file);
      if (memory) {
        if (stat.size > 256_000) continue;
        try {
          const data = JSON.parse(await fs.readFile(file, 'utf8'));
          for (const turn of data.turns || []) add(turn.user, source, stat.mtime.toISOString(), 'User (saved recent conversation)');
        } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      } else {
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        for await (const line of lines) {
          try {
            const record = JSON.parse(line);
            // Assistant output is not independent evidence about the user.
            if (record.role === 'user') add(record.text, source,
              typeof record.timestamp === 'string' ? record.timestamp : stat.mtime.toISOString(),
              `User on device ${String(record.device_id || 'unknown')} at ${String(record.timestamp || 'unknown time')}`);
          } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        }
      }
    }
  }
  return hits;
}
