#!/usr/bin/env python3
import asyncio
import json
import os
import socket
import sys
import urllib.error
import urllib.request
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
active_clients = set()


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
    await socket.send(bytes(1600))
    while chunk := await reader.read(3200):
        await socket.send(chunk)


async def receive_transcripts(socket, ingest_key):
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
        if not transcript:
            continue
        if not event.get("is_final"):
            print(f"\rHearing: {transcript}", end="", flush=True)
            continue

        print(f"\rYou said: {transcript}                    ", flush=True)
        try:
            result = await asyncio.to_thread(submit_query, transcript, ingest_key)
            print(f"Answer: {result.get('answer', result)}", flush=True)
        except (OSError, urllib.error.HTTPError) as error:
            print(f"System API error: {error}", file=sys.stderr)


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
        }
    )

    try:
        async with websockets.connect(
            f"wss://api.deepgram.com/v1/listen?{query}",
            additional_headers={"Authorization": f"Token {deepgram_key}"},
            ping_interval=20,
        ) as socket:
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
