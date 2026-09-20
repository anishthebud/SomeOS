import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withDeviceConversation } from '../lib/iot-conversation.ts';

test('device memory persists, isolates sessions, bounds history, and recovers from failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'someos-memory-'));
  const previous = process.env.IOT_MEMORY_DIR;
  process.env.IOT_MEMORY_DIR = directory;
  const query = (question, callback, extra = {}) => withDeviceConversation({ deviceId: 'test', question, ...extra }, callback);
  try {
    await query('My name is Sam.', async history => {
      assert.deepEqual(history, []);
      return { answer: 'Hello Sam.' };
    });
    const files = await fs.readdir(directory);
    assert.equal(files.length, 1);
    assert.equal((await fs.stat(path.join(directory, files[0]))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8')).turns[0].user, 'My name is Sam.');
    await query('What is my name?', async history => {
      assert.equal(history[0].content, 'My name is Sam.');
      assert.equal(history[1].role, 'assistant');
      return { answer: 'Sam.' };
    });
    for (const scope of [{ deviceId: 'other' }, { sessionId: 'other' }]) {
      await query('Who am I?', async history => {
        assert.deepEqual(history, []);
        return { answer: 'Unknown.' };
      }, scope);
    }
    await assert.rejects(query('failed', async () => { throw new Error('model failure'); }), /model failure/);
    await query('reset', async history => {
      assert.deepEqual(history, []);
      return { answer: 'New conversation.' };
    }, { reset: true });
    await Promise.all(Array.from({ length: 15 }, (_, i) => query(`turn ${i}`, async history => {
      if (i > 0) assert.equal(history.at(-2).content, `turn ${i - 1}`);
      assert.ok(history.length <= 24);
      assert.ok(!history.some(message => message.content === 'failed'));
      await new Promise(resolve => setTimeout(resolve, 2));
      return { answer: `answer ${i}` };
    })));
    const file = path.join(directory, files[0]);
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(stored.turns.length, 12);
    stored.updatedAt = Date.now() - 25 * 60 * 60 * 1000;
    await fs.writeFile(file, JSON.stringify(stored));
    await query('after a long absence', async history => {
      assert.equal(history.length, 24);
      assert.equal(history.at(-2).content, 'turn 14');
      return { answer: 'Welcome back.' };
    });
  } finally {
    if (previous === undefined) delete process.env.IOT_MEMORY_DIR;
    else process.env.IOT_MEMORY_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
