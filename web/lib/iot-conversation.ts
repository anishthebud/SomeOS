import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ConversationMessage = { role: "user" | "assistant"; content: string };
type Turn = { user: string; assistant: string };
type StoredConversation = { version: 1; updatedAt: number; turns: Turn[] };
const MAX_TURNS = 12;
const MAX_CHARACTERS = 24_000;

// Keep serialization across Next.js development reloads. Files preserve history
// across process restarts; each device/session has its own queue and file.
const state = globalThis as typeof globalThis & { iotConversationQueues?: Map<string, Promise<void>> };
const queues = state.iotConversationQueues ??= new Map<string, Promise<void>>();

function bounded(turns: Turn[]): Turn[] {
  const result = turns.slice(-MAX_TURNS);
  let characters = result.reduce((sum, turn) => sum + turn.user.length + turn.assistant.length, 0);
  while (characters > MAX_CHARACTERS && result.length) {
    const oldest = result.shift()!;
    characters -= oldest.user.length + oldest.assistant.length;
  }
  return result;
}

async function readHistory(file: string): Promise<Turn[]> {
  let content: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > 256_000) throw new Error("Conversation history is too large");
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const stored = JSON.parse(content) as StoredConversation;
  if (stored.version !== 1 || !Number.isFinite(stored.updatedAt) || !Array.isArray(stored.turns) ||
      !stored.turns.every((turn) => turn && typeof turn.user === "string" && typeof turn.assistant === "string")) {
    throw new Error("Invalid conversation history");
  }
  return bounded(stored.turns);
}

export async function withDeviceConversation<T extends { answer: string }>(
  input: { deviceId: string; sessionId?: string; question: string; reset?: boolean },
  answer: (history: ConversationMessage[]) => Promise<T>,
): Promise<T> {
  const directory = path.resolve(process.env.IOT_MEMORY_DIR || path.join(process.cwd(), ".run/iot-conversations"));
  const id = createHash("sha256").update(JSON.stringify([input.deviceId, input.sessionId || "default"])).digest("hex");
  const file = path.join(directory, `${id}.json`);
  const previous = queues.get(file) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => done);
  queues.set(file, tail);
  await previous;
  try {
    const turns = input.reset ? [] : await readHistory(file);
    const history = turns.flatMap((turn): ConversationMessage[] => [
      { role: "user", content: turn.user }, { role: "assistant", content: turn.assistant },
    ]);
    const result = await answer(history);
    const stored: StoredConversation = {
      version: 1,
      updatedAt: Date.now(),
      turns: bounded([...turns, { user: input.question, assistant: result.answer }]),
    };
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(stored), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return result;
  } finally {
    release();
    if (queues.get(file) === tail) queues.delete(file);
  }
}
