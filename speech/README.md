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
  --fqbn arduino:zephyr:unoq \
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
