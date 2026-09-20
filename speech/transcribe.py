#!/usr/bin/env python3
"""USB debugging path. Use network_transcribe.py for UNO Q deployments."""
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlencode

import serial
import websockets
from websockets.exceptions import ConnectionClosed

SERIAL_PORT = os.environ.get("UNO_Q_PORT", "/dev/cu.usbmodem15312720332")
SAMPLE_RATE = 32000
SYSTEM_API_URL = os.environ.get(
    "HEARTH_API_URL", "http://127.0.0.1:3000/api/iot/query"
)
DEVICE_ID = os.environ.get("HEARTH_DEVICE_ID", "uno-q")
ROOM = os.environ.get("HEARTH_ROOM", "kitchen")


async def send_audio(socket, device):
    # Prevent Deepgram's startup timeout while the serial device resets/opens.
    await socket.send(bytes(3200))

    while True:
        chunk = await asyncio.to_thread(device.read, 3200)
        if chunk:
            await socket.send(chunk)


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


async def print_transcripts(socket, ingest_key):
    async for message in socket:
        if isinstance(message, bytes):
            continue

        event = json.loads(message)
        if event.get("type") != "Results":
            continue

        alternatives = event.get("channel", {}).get("alternatives", [])
        if not alternatives:
            continue

        transcript = alternatives[0].get("transcript", "").strip()
        if transcript:
            if event.get("is_final"):
                print(f"\rYou said: {transcript}                    ", flush=True)
                try:
                    result = await asyncio.to_thread(
                        submit_query, transcript, ingest_key
                    )
                    print(f"Answer: {result.get('answer', result)}", flush=True)
                except (OSError, urllib.error.HTTPError) as error:
                    print(f"System API error: {error}", file=sys.stderr)
            else:
                print(f"\rHearing: {transcript}", end="", flush=True)


async def main():
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        raise SystemExit("DEEPGRAM_API_KEY is not set in this terminal")
    ingest_key = os.environ.get("IOT_INGEST_KEY")
    if not ingest_key:
        raise SystemExit("IOT_INGEST_KEY is not set in this terminal")

    query = urlencode(
        {
            "model": "nova-3",
            "encoding": "linear16",
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "smart_format": "true",
            "interim_results": "true",
            "vad_events": "true",
        }
    )
    url = f"wss://api.deepgram.com/v1/listen?{query}"

    print(f"Opening {SERIAL_PORT}; press Ctrl+C to stop")
    try:
        with serial.Serial(SERIAL_PORT, 921600, timeout=0.25) as device:
            device.reset_input_buffer()
            async with websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {api_key}"},
                ping_interval=20,
            ) as socket:
                print("Connected to Deepgram. Speak close to the microphone.")
                sender = asyncio.create_task(send_audio(socket, device))
                receiver = asyncio.create_task(print_transcripts(socket, ingest_key))
                done, pending = await asyncio.wait(
                    {sender, receiver}, return_when=asyncio.FIRST_EXCEPTION
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    task.result()
    except ConnectionClosed as error:
        raise SystemExit(f"Deepgram connection closed: {error}") from None


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped")
    except serial.SerialException as error:
        print(f"Serial error: {error}", file=sys.stderr)
        raise SystemExit(1)
