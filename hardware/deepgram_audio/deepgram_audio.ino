#include <Arduino.h>
#include <Arduino_RouterBridge.h>

constexpr int kMicPin = A0;
constexpr int kAdcBits = 14;
constexpr int kBlockSamples = 160;
constexpr int kSoftwareGain = 32;

int16_t audioBlock[kBlockSamples];

void setup() {
  Bridge.begin();
  Monitor.begin(921600);
  analogReadResolution(kAdcBits);
  pinMode(kMicPin, INPUT);
  delay(2000);

  long total = 0;
  for (int i = 0; i < 256; ++i) {
    total += analogRead(kMicPin);
  }

  // Keep the baseline in Q8 fixed-point for slow DC-bias tracking.
  long baselineQ8 = (total / 256L) << 8;

  while (true) {
    for (int i = 0; i < kBlockSamples; ++i) {
      const int raw = analogRead(kMicPin);
      baselineQ8 += (((static_cast<long>(raw) << 8) - baselineQ8) >> 12);

      long centered = raw - (baselineQ8 >> 8);
      centered *= kSoftwareGain;
      centered = constrain(centered, -32768L, 32767L);
      audioBlock[i] = static_cast<int16_t>(centered);
    }

    Monitor.write(reinterpret_cast<const uint8_t *>(audioBlock),
                  sizeof(audioBlock));
  }
}

void loop() {}
