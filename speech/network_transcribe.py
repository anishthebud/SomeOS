#!/usr/bin/env python3
import asyncio
import json
import math
import struct
import time
import os
import socket
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlencode

import websockets
from websockets.exceptions import ConnectionClosed


LISTEN_HOST = os.environ.get("AUDIO_LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("AUDIO_LISTEN_PORT", "5050"))
SAMPLE_RATE = 16000
SYSTEM_API_URL = os.environ.get(
    "HEARTH_API_URL", "http://127.0.0.1:3000/api/iot/query"
)
DEVICE_ID = os.environ.get("HEARTH_DEVICE_ID", "uno-q")
ROOM = os.environ.get("HEARTH_ROOM", "kitchen")
AUDIO_SHARED_KEY = os.environ.get("AUDIO_SHARED_KEY", "").encode("utf-8")
STATUS_INTERVAL = int(os.environ.get("AUDIO_STATUS_INTERVAL", "10"))
TRANSCRIPT_PATH = Path(os.environ.get(
    "SPEECH_TRANSCRIPT_PATH",
    str(Path(__file__).resolve().parents[1] / ".run" / "transcripts" / "conversation.jsonl"),
)).expanduser()
active_clients = set()


def record_transcript(role, text, exchange_id):
    """Append completed speech/replies independently of bounded model memory."""
    now = datetime.now(timezone.utc)
    # Use the ASUS local calendar date, recalculated for every record so a
    # running receiver rolls over at midnight without restarting.
    day = now.astimezone().date().isoformat()
    path = TRANSCRIPT_PATH.with_name(f"{TRANSCRIPT_PATH.stem}-{day}{TRANSCRIPT_PATH.suffix}")
    record = {
        "timestamp": now.isoformat(),
        "device_id": DEVICE_ID,
        "room": ROOM,
        "exchange_id": exchange_id,
        "role": role,
        "text": text,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as output:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
            output.flush()
    except OSError as error:
        print(f"Transcript could not be saved: {error}", file=sys.stderr, flush=True)



def submit_query(transcript, ingest_key):
    payload = json.dumps(
        {
            "device_id": DEVICE_ID,
            "room": ROOM,
            "text": transcript,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        SYSTEM_API_URL,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-someos-key": ingest_key,
        },
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)


async def send_audio(socket, reader):
    started = time.monotonic()
    samples = energy = peak = 0
    pending = b""
    while chunk := await reader.read(3200):
        pending += chunk
        size = len(pending) & ~1
        if not size:
            continue
        pcm, pending = pending[:size], pending[size:]
        values = struct.unpack(f"<{size // 2}h", pcm)
        samples += len(values)
        energy += sum(value * value for value in values)
        peak = max(peak, max(abs(value) for value in values))
        await socket.send(pcm)
        elapsed = time.monotonic() - started
        if elapsed >= 10:
            print(
                f"Audio: {samples / elapsed:.0f} samples/s, "
                f"RMS {math.sqrt(energy / samples):.1f}, peak {peak}",
                flush=True,
            )
            started = time.monotonic()
            samples = energy = peak = 0
    if pending:
        print("Audio ended with an incomplete PCM sample", file=sys.stderr)


async def receive_transcripts(socket, ingest_key):
    last_empty_report = 0.0
    final_segments = []
    questions = asyncio.Queue(maxsize=16)

    def finish_utterance():
        if not final_segments:
            return
        transcript = " ".join(final_segments)
        final_segments.clear()
        print(f"\rYou said: {transcript}                    ", flush=True)
        exchange_id = uuid.uuid4().hex
        record_transcript("user", transcript, exchange_id)
        try:
            questions.put_nowait((transcript, exchange_id))
        except asyncio.QueueFull:
            print("Assistant queue full; this utterance was not submitted", file=sys.stderr)

    async def answer_questions():
        while True:
            transcript, exchange_id = await questions.get()
            try:
                result = await asyncio.to_thread(submit_query, transcript, ingest_key)
                answer = result.get("answer", result)
                record_transcript("assistant", answer, exchange_id)
                print(f"Answer: {answer}", flush=True)
            except (OSError, ValueError) as error:
                print(f"System API error: {error}", file=sys.stderr)
            finally:
                questions.task_done()

    worker = asyncio.create_task(answer_questions())
    try:
        async for message in socket:
            if isinstance(message, bytes):
                continue
            event = json.loads(message)
            kind = event.get("type")
            if kind == "Error":
                print(f"Deepgram error: {event.get('description', event.get('message', 'unknown'))}", flush=True)
                continue
            if kind == "SpeechStarted":
                print("Deepgram detected speech", flush=True)
                continue
            if kind == "UtteranceEnd":
                finish_utterance()
                continue
            if kind != "Results":
                continue
            alternatives = event.get("channel", {}).get("alternatives", [])
            transcript = alternatives[0].get("transcript", "").strip() if alternatives else ""
            if transcript and event.get("is_final"):
                final_segments.append(transcript)
            if transcript:
                hearing = " ".join(final_segments) if event.get("is_final") else " ".join([*final_segments, transcript])
                print(f"\rHearing: {hearing}", end="", flush=True)
            elif time.monotonic() - last_empty_report >= 10:
                print("Deepgram is responding, but has not recognized words in this audio segment", flush=True)
                last_empty_report = time.monotonic()
            if event.get("speech_final"):
                finish_utterance()
        finish_utterance()
        await questions.join()
    finally:
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)


async def handle_uno_q(reader, writer, deepgram_key, ingest_key):
    peer = writer.get_extra_info("peername")
    try:
        header = await asyncio.wait_for(reader.readexactly(5), timeout=5)
        if header[:4] != b"HRTA":
            raise PermissionError("invalid audio protocol")
        supplied_key = await asyncio.wait_for(
            reader.readexactly(header[4]), timeout=5
        )
        if supplied_key != AUDIO_SHARED_KEY:
            raise PermissionError("invalid audio key")
    except (asyncio.IncompleteReadError, asyncio.TimeoutError, PermissionError) as error:
        print(f"Rejected audio client {peer}: {error}", file=sys.stderr)
        writer.close()
        await writer.wait_closed()
        return

    print(f"Authenticated UNO Q connected from {peer}")
    active_clients.add(peer)
    query = urlencode(
        {
            "model": "nova-3",
            "encoding": "linear16",
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "smart_format": "true",
            "interim_results": "true",
            "vad_events": "true",
            "endpointing": 1000,
            "utterance_end_ms": 1500,
        }
    )

    try:
        async with websockets.connect(
            f"wss://api.deepgram.com/v1/listen?{query}",
            additional_headers={"Authorization": f"Token {deepgram_key}"},
            ping_interval=20,
        ) as socket:
            print("Deepgram connected: Nova-3, 16000 Hz mono PCM", flush=True)
            sender = asyncio.create_task(send_audio(socket, reader))
            receiver = asyncio.create_task(receive_transcripts(socket, ingest_key))
            done, pending = await asyncio.wait(
                {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except ConnectionClosed as error:
        print(f"Deepgram connection closed: {error}", file=sys.stderr)
    except Exception as error:
        print(f"Audio session failed: {error}", file=sys.stderr)
    finally:
        active_clients.discard(peer)
        writer.close()
        await writer.wait_closed()
        print(f"UNO Q disconnected: {peer}")


def local_ipv4_addresses():
    addresses = set()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(result[4][0])
    except socket.gaierror:
        pass
    return sorted(address for address in addresses if not address.startswith("127."))


async def report_connection_status():
    while True:
        await asyncio.sleep(STATUS_INTERVAL)
        if active_clients:
            continue
        addresses = local_ipv4_addresses()
        destination = ", ".join(f"{address}:{LISTEN_PORT}" for address in addresses)
        print(
            "Still waiting for the UNO Q. No TCP connection has reached this "
            f"receiver. Configure kAudioHost to one of: {destination or 'this host IP'}, "
            "and verify the UNO Q RouterBridge/Wi-Fi connection.",
            flush=True,
        )


async def main():
    deepgram_key = os.environ.get("DEEPGRAM_API_KEY")
    ingest_key = os.environ.get("IOT_INGEST_KEY")
    if not deepgram_key:
        raise SystemExit("DEEPGRAM_API_KEY is not set")
    if not ingest_key:
        raise SystemExit("IOT_INGEST_KEY is not set")
    if not AUDIO_SHARED_KEY:
        raise SystemExit("AUDIO_SHARED_KEY is not set")

    server = await asyncio.start_server(
        lambda reader, writer: handle_uno_q(
            reader, writer, deepgram_key, ingest_key
        ),
        LISTEN_HOST,
        LISTEN_PORT,
    )
    addresses = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
    print(f"Listening for UNO Q audio on {addresses}")
    local_addresses = local_ipv4_addresses()
    if local_addresses:
        print(
            "UNO Q destination candidates: "
            + ", ".join(f"{address}:{LISTEN_PORT}" for address in local_addresses)
        )
    print("Waiting for an authenticated UNO Q connection...", flush=True)
    async with server:
        status_task = asyncio.create_task(report_connection_status())
        try:
            await server.serve_forever()
        finally:
            status_task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped")
