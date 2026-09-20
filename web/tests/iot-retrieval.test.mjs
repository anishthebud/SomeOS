import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { retrieveIotHistory } from '../lib/iot-retrieval.ts';

test('retrieves older speech and saved memory while ignoring replies and malformed lines', async () => {
  const cwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iot-retrieval-'));
  const previous = { memory: process.env.IOT_MEMORY_DIR, transcript: process.env.SPEECH_TRANSCRIPT_PATH };
  delete process.env.IOT_MEMORY_DIR;
  delete process.env.SPEECH_TRANSCRIPT_PATH;
  try {
    process.chdir(root);
    await fs.mkdir('.run/transcripts', { recursive: true });
    await fs.mkdir('.run/iot-conversations', { recursive: true });
    await fs.writeFile('.run/transcripts/conversation-2025-01-01.jsonl', [
      JSON.stringify({ role: 'user', text: 'The telescope is in the attic.', device_id: 'uno-q', timestamp: '2025-01-01' }),
      JSON.stringify({ role: 'assistant', text: 'The telescope is on Mars.' }), '{partial',
    ].join('\n'));
    await fs.writeFile(`.run/iot-conversations/${'a'.repeat(64)}.json`, JSON.stringify({ turns: [{ user: 'My name is Sam.', assistant: 'Hello.' }] }));
    const hits = await retrieveIotHistory('Where is the telescope?');
    assert.match(hits[0].excerpt, /attic/);
    assert.ok(hits.some(hit => hit.excerpt.includes('Sam')));
    assert.ok(!hits.some(hit => hit.excerpt.includes('Mars')));
    assert.equal(hits.length, 2);
  } finally {
    process.chdir(cwd);
    for (const [key,value] of [['IOT_MEMORY_DIR',previous.memory], ['SPEECH_TRANSCRIPT_PATH',previous.transcript]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
