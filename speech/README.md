# UNO Q Speech To Text

This pipeline reads the SPW2430 from `A0` on the UNO Q and sends signed 16-bit
mono PCM directly over the local network to the ASUS. The ASUS transcribes the
stream and sends final transcripts to the system's HTTP query endpoint. The Mac
is not part of the deployed data path.

## Wiring

- SPW2430 `VCC` to UNO Q `3.3V`
- SPW2430 `GND` to UNO Q `GND`
- SPW2430 `AUD/OUT` to UNO Q `A0`

The UNO Q analog input must not exceed 3.3 V.

## Configure And Flash Network Audio

The UNO Q and ASUS must be on the same network, and TCP port `5050` must be
reachable from the UNO Q. Set the ASUS LAN IP and shared audio key while
compiling; this avoids committing either deployment value:

```bash
arduino-cli compile --upload \
  --fqbn arduino:zephyr:unoq:link_mode=static \
  --port /dev/cu.usbmodemXXXX \
  --build-property 'compiler.cpp.extra_flags=-DAUDIO_HOST=192.168.8.100 -DAUDIO_SHARED_KEY=replace-this-key' \
  hardware/network_audio
```

Replace `192.168.8.100` with the ASUS address and use the same value for
`AUDIO_SHARED_KEY` on the ASUS. Find the current serial port with
`arduino-cli board list`.

The UNO Q's Linux side must also be connected to Wi-Fi. From a machine with
ADB access, verify it before troubleshooting the audio process:

```bash
adb shell nmcli device status
adb shell ip route
```

`wlan0` must say `connected`, and `ip route` must include a default route. If
the saved `arduinoboards` profile is disconnected, activate it with:

```bash
adb shell nmcli connection up arduinoboards
```

## Run The ASUS Audio Receiver

Create and activate a Python virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r speech/requirements.txt
```

Set the Deepgram API key and shared system key on the ASUS, then start the TCP
audio receiver:

```bash
export DEEPGRAM_API_KEY=your_key_here
export IOT_INGEST_KEY=your_shared_local_key
export AUDIO_SHARED_KEY=the-key-compiled-into-network_audio
export HEARTH_API_URL=http://127.0.0.1:3000/api/iot/query
python speech/network_transcribe.py
```

Configure the same `IOT_INGEST_KEY` in `web/.env.local`. Each final transcript
is posted to `/api/iot/query`, which passes it to the existing local knowledge
assistant. Optional sender settings are `HEARTH_DEVICE_ID` and `HEARTH_ROOM`.

The older `hardware/deepgram_audio` and `speech/transcribe.py` path remains
available for USB debugging, but it is not needed in the final deployment.


Do not commit either key. This implementation sends audio to Deepgram over the
internet; it is not an offline speech recognition model.

## UNO Q core 1.0.0: audio throughput

The network sketch uses a **1,000,000 baud internal RouterBridge link**. The
Linux router must use the same `--serial-baudrate 1000000` setting. The default
115200 baud cannot carry 32,000 PCM bytes/second plus RPC overhead. Changing
`Monitor.begin(115200)` does not change the internal link speed.

On the board, an administrator can configure a service override with
`sudo systemctl edit arduino-router`:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/arduino-router --unix-port /var/run/arduino-router.sock --serial-port /dev/ttyHS1 --serial-baudrate 1000000 --after-ready '/usr/bin/gpioset -c /dev/gpiochip1 -t0 70=1'
```

Then run `sudo systemctl daemon-reload` and `sudo systemctl restart arduino-router`.
This command preserves the ready-pin behavior of the tested UNO Q service;
check `systemctl cat arduino-router` if using a different board image. Flash
the matching sketch and reset the MCU after changing router speed. A mismatch
prevents Bridge startup. `AUDIO_BRIDGE_BAUD` can override the sketch setting.

The sketch initializes A0 using Arduino, then performs direct STM32 ADC1
conversions. On the tested core, calling `analogRead()` for every sample was
too slow. ADC1 is dedicated to this sketch: do not add other ADC1 users or
`analogRead()` calls after initialization. Acquisition time is reduced from the
core's maximum 814 cycles to 36 cycles for the microphone's buffered output.

TIM16 triggers sampling at 16 kHz independently of TCP writes. A 16-block ring
buffer holds up to 320 ms of audio. The timer interrupt runs below the bridge
UART priority; on an ADC timeout or buffer overflow, the stream is restarted
rather than silently submitting discontinuous PCM. TIM16 is dedicated to audio:
do not use the Servo library or another TIM16 user in this sketch. Use the
statically linked build shown above, which was tested on core 1.0.0.

The earlier blocking sample/send loop achieved the expected average data rate
but paused sampling during network writes and then caught up in bursts. It
produced poor recognition of spoken sentences. A correct byte rate alone does
not establish audio timing quality.

With timer-driven sampling, an authenticated 160,000-sample capture took 10.021
seconds with zero dropped blocks and zero ADC timeouts. Observed interrupt
intervals were about 48–77 microseconds around the 62.5-microsecond target.
Sample-difference RMS at block boundaries was 326.6, compared with 322.6 for
other adjacent samples in that capture. Speech-recognition accuracy still
requires a live sentence test. The test used a temporary user router;
its speed setting does **not** persist across board reboots. Apply the service
override above for deployment.

If port 3000 serves another checkout, start this checkout on another port and
set `HEARTH_API_URL` accordingly, for example
`http://127.0.0.1:3001/api/iot/query`. The `/api/iot/query` route must return 401
for an unauthenticated request, rather than 404.

The network sketch rebuilds its TCP client after failed writes to discard stale
connection state. Longer receiver outages can still stall a RouterBridge RPC:
the installed library has no RPC timeout. For the current USB-connected ASUS
bench test, `.run/start-network-speech.py` resets the MCU before starting the
receiver. Keep USB connected for that startup recovery. This workaround is not
a verified unattended, network-only deployment fix.

## Complete spoken questions

The live timer-driven test recognized phrases such as "The blue backpack" and
"on the kitchen table", improving on the earlier repeated "No" results. The
receiver now combines finalized segments until `speech_final` or `UtteranceEnd`
and requests 1000 ms endpointing with a 1500 ms utterance-end fallback. Pause
for roughly a second after a question. Longer pauses can still split speech.
Assistant requests run in a bounded queue so a slow answer does not block
incoming recognition events. See Deepgram's
[endpointing and interim-results guidance](https://developers.deepgram.com/docs/understand-endpointing-interim-results).
Restart the receiver after source changes; an already running Python process
continues using its loaded code. Full utterance grouping has local event tests;
its live sentence test requires restarting the receiver with this version.

## Voice conversation memory

The device query endpoint remembers recent successful exchanges, so “My name
is Shreyas, and I like bananas” can supply the answer to “What is my name?”
Only new requests handled by this version enter memory; earlier speech logs
are not imported. This does not write personal facts into the knowledge vault.

History is scoped by `device_id` and optional `session_id` (default `default`).
Everyone using the same device/session shares that history. To start fresh,
send a new `session_id`, or include `"reset_memory": true` with the next query;
the reset is saved when that query succeeds. The existing receiver uses the
default session.

The server retains at most 12 exchanges and 24,000 characters per conversation.
Recent memory does not expire with inactivity. Its size limit still applies;
the full daily transcripts are retained separately. Both web and voice answers
retrieve up to six relevant saved user statements from daily transcripts, the
legacy transcript, and recent IoT memory. Retrieval uses word matching with
recent statements as fallback; it is not exhaustive semantic recall. Assistant
replies are excluded as evidence. Statements from different devices may belong
to different speakers. Source paths are cited but are not added to the file browser.
Configure SPEECH_TRANSCRIPT_PATH in the web environment too if the receiver
uses a custom transcript location.
Storage defaults to `.run/iot-conversations` under the web server's working
directory. Set `IOT_MEMORY_DIR` in the web environment to choose an explicit
location. Files use owner-only permissions and persist across server restarts.
Delete these files while the server is stopped to erase stored conversations.
Request serialization supports a single web server process; multiple server
instances need shared transactional storage before using this feature.

Run the memory behavior tests with Node 22.20 or later:

```bash
node --experimental-strip-types --test web/tests/iot-conversation.test.mjs
```

## Continuously updated transcript

The network receiver appends completed utterances and assistant replies to
`.run/transcripts/conversation-YYYY-MM-DD.jsonl` in this checkout. The date uses
the ASUS local timezone, and the receiver switches files at midnight as new
records arrive. Files are created only on days with activity and are never
automatically deleted or truncated. Existing `.run/conversation.jsonl` files
are preserved. Each line is a separate JSON object
with `timestamp`, `device_id`, `room`, `exchange_id`, `role`, and `text` fields.
Matching exchange IDs connect a reply to its utterance even when more speech
arrives before the reply. Interim recognition guesses are not recorded.

Speech is saved before requesting an answer, including when the request fails
or the assistant queue is full. The file appends across receiver restarts and
is independent of the assistant's bounded conversation memory. It has no
automatic expiry or deletion. Daily files append when reused. Previous terminal output is not imported.
Set `SPEECH_TRANSCRIPT_PATH` to choose a different base filename; for example,
`/data/chat.jsonl` writes `/data/chat-YYYY-MM-DD.jsonl`. Storage failures are
reported in the terminal while recognition continues. The default `.run/`
location is ignored by Git, and newly created transcript files are owner-only.

Restart the receiver to enable recording, then follow updates with:

```bash
tail -F ".run/transcripts/conversation-$(date +%F).jsonl"
```

Read all records in Python with
`[json.loads(line) for line in open(".run/transcripts/conversation-2026-09-19.jsonl")]`.
The tail command follows the selected day; run it again after midnight.

## Physical microphone mute

The network firmware uses a latching mute toggle:

- Connect the push button between **D2 and GND**. The firmware enables the
  internal pull-up; each debounced press toggles mute. Holding it does not
  repeatedly toggle.
- Connect **D4 through a current-limiting resistor to the LED anode**, with the
  cathode connected to GND. HIGH means muted: **LED on = muted**.
- Normally the board starts unmuted. Holding the button during startup starts
  muted. The setting is not saved across power cycles.

Mute is processed in a separate thread, including during blocked network RPCs.
While muted, PCM samples are replaced with zeroes, keeping the existing audio
connection alive. Queued audio is cleared on both mute transitions. Audio that
was already sent or submitted to RouterBridge before the press cannot be
retracted; a prior utterance may still finish transcribing or receive an answer.
The ADC still samples to track microphone DC bias, but muted samples are not
retained as microphone PCM in the outgoing ring buffer.

This change requires recompiling and flashing `hardware/network_audio`; a
receiver restart alone does not install it. The older USB debugging sketch does
not implement this button.
