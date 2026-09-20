#include <Arduino.h>
#include <Arduino_RouterBridge.h>

// Override these with compiler.cpp.extra_flags when flashing each deployment.
#ifndef AUDIO_HOST
#define AUDIO_HOST asus.local
#endif
#ifndef AUDIO_PORT
#define AUDIO_PORT 5050
#endif
#ifndef AUDIO_SHARED_KEY
#define AUDIO_SHARED_KEY hearth-bench-test
#endif

#define STRINGIFY_VALUE(value) #value
#define STRINGIFY(value) STRINGIFY_VALUE(value)

constexpr char kAudioHost[] = STRINGIFY(AUDIO_HOST);
constexpr uint16_t kAudioPort = AUDIO_PORT;
constexpr char kAudioSharedKey[] = STRINGIFY(AUDIO_SHARED_KEY);
constexpr int kMicPin = A0;
constexpr int kAdcBits = 14;
constexpr uint32_t kSampleRate = 16000;
constexpr size_t kBlockSamples = 320;  // 20 ms of audio.
constexpr int kSoftwareGain = 32;

BridgeTCPClient<> client(Bridge);
int16_t audioBlock[kBlockSamples];
long baselineQ8 = 0;
uint32_t nextSampleMicros = 0;
uint32_t sampleRemainder = 0;

void waitForNextSample() {
  while (static_cast<int32_t>(micros() - nextSampleMicros) < 0) {
    delayMicroseconds(1);
  }

  nextSampleMicros += 1000000UL / kSampleRate;
  sampleRemainder += 1000000UL % kSampleRate;
  if (sampleRemainder >= kSampleRate) {
    nextSampleMicros++;
    sampleRemainder -= kSampleRate;
  }
}

bool writeAll(const uint8_t *data, size_t length) {
  while (length > 0 && client.connected()) {
    const size_t written = client.write(data, length);
    if (written == 0) {
      return false;
    }
    data += written;
    length -= written;
  }
  return length == 0;
}

bool connectToAsus() {
  Monitor.print("Connecting to audio receiver at ");
  Monitor.print(kAudioHost);
  Monitor.print(':');
  Monitor.println(kAudioPort);

  if (client.connect(kAudioHost, kAudioPort) < 0) {
    Monitor.println("Connection failed; retrying");
    return false;
  }

  Monitor.println("Audio stream connected");
  const uint8_t keyLength = strlen(kAudioSharedKey);
  const uint8_t header[] = {'H', 'R', 'T', 'A', keyLength};
  if (!writeAll(header, sizeof(header)) ||
      !writeAll(reinterpret_cast<const uint8_t *>(kAudioSharedKey), keyLength)) {
    Monitor.println("Audio authentication header failed");
    client.stop();
    return false;
  }
  nextSampleMicros = micros();
  sampleRemainder = 0;
  return true;
}

void setup() {
  Bridge.begin();
  Monitor.begin(115200);
  analogReadResolution(kAdcBits);
  pinMode(kMicPin, INPUT);

  delay(1000);
  long total = 0;
  for (int i = 0; i < 256; ++i) {
    total += analogRead(kMicPin);
  }
  baselineQ8 = (total / 256L) << 8;
}

void loop() {
  if (!client.connected()) {
    client.stop();
    if (!connectToAsus()) {
      delay(2000);
      return;
    }
  }

  for (size_t i = 0; i < kBlockSamples; ++i) {
    waitForNextSample();
    const int raw = analogRead(kMicPin);
    baselineQ8 += (((static_cast<long>(raw) << 8) - baselineQ8) >> 12);

    long centered = (raw - (baselineQ8 >> 8)) * kSoftwareGain;
    centered = constrain(centered, -32768L, 32767L);
    audioBlock[i] = static_cast<int16_t>(centered);
  }

  if (!writeAll(reinterpret_cast<const uint8_t *>(audioBlock),
                sizeof(audioBlock))) {
    Monitor.println("Audio connection lost");
    client.stop();
  }
}
