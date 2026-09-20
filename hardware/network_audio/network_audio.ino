#include <Arduino.h>
#include <Arduino_RouterBridge.h>
#include <memory>
#include <zephyr/drivers/counter.h>
#include <zephyr/kernel.h>
#include <stm32u5xx_ll_adc.h>

// This microphone sketch exclusively owns ADC1 after Arduino initializes A0.
// Per-sample analogRead()/adc_read() is too slow on the UNO Q 1.0.0 core.
int readMic() {
  LL_ADC_ClearFlag_EOC(ADC1);
  LL_ADC_ClearFlag_EOS(ADC1);
  LL_ADC_ClearFlag_OVR(ADC1);
  LL_ADC_REG_StartConversion(ADC1);
  unsigned spins = 0;
  while (!LL_ADC_IsActiveFlag_EOC(ADC1)) {
    if (++spins > 1000) return -1;
  }
  return LL_ADC_REG_ReadConversionData32(ADC1);
}

// Override these with compiler.cpp.extra_flags when flashing each deployment.
#ifndef AUDIO_HOST
#define AUDIO_HOST asus.local
#endif
#ifndef AUDIO_BRIDGE_BAUD
#define AUDIO_BRIDGE_BAUD 1000000
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
static_assert(sizeof(kAudioSharedKey) > 1 && sizeof(kAudioSharedKey) <= 256,
              "Audio key must contain 1-255 bytes");
constexpr int kMicPin = A0;
constexpr int kMuteButtonPin = 2;  // Button to GND, active LOW.
constexpr int kMuteLedPin = 4;     // Active HIGH, with series resistor.
constexpr uint32_t kButtonDebounceMs = 30;
constexpr int kAdcBits = 14;
constexpr uint32_t kSampleRate = 16000;
constexpr size_t kBlockSamples = 320;  // 20 ms of audio.
constexpr int kSoftwareGain = 32;

using AudioClient = BridgeTCPClient<>;
std::unique_ptr<AudioClient> client;

void resetAudioClient() {
  if (client) client->stop();
  // stop() may retain connected=true when the router already closed the socket.
  // A fresh client discards that stale connection ID before the next attempt.
  client.reset(new AudioClient(Bridge));
  client->begin();
}
// TIM16 is dedicated to this sketch (do not use Servo at the same time).
// The timer samples independently of synchronous RouterBridge network writes.
const struct device *sampleTimer = DEVICE_DT_GET(DT_NODELABEL(counter_servo));
static int16_t captureRing[16][kBlockSamples];
static volatile uint32_t producedBlocks = 0;
static volatile uint32_t consumedBlocks = 0;
static int16_t audioBlock[kBlockSamples];
static size_t capturePosition = 0;
static long baselineQ8 = 0;
static volatile uint32_t capturedSamples = 0;
static volatile uint32_t droppedBlocks = 0;
static volatile uint32_t adcTimeouts = 0;
static volatile uint32_t minSampleCycles = UINT32_MAX;
static volatile uint32_t maxSampleCycles = 0;
static uint32_t previousSampleCycle = 0;
static bool timerReady = false;
static volatile bool microphoneMuted = false;
static volatile uint32_t muteGeneration = 0;
static uint32_t blockGeneration[16];
K_THREAD_STACK_DEFINE(muteThreadStack, 1024);
static struct k_thread muteThread;

// A dedicated thread keeps physical mute responsive during blocking bridge RPCs.
// No bridge or Monitor calls belong here. Sampling and this thread share one MCU.
void pollMuteButton(void *, void *, void *) {
  bool previousPressed = digitalRead(kMuteButtonPin) == LOW;
  bool stablePressed = previousPressed;
  uint32_t changedAt = k_uptime_get_32();
  while (true) {
    const bool pressed = digitalRead(kMuteButtonPin) == LOW;
    const uint32_t now = k_uptime_get_32();
    if (pressed != previousPressed) {
      previousPressed = pressed;
      changedAt = now;
    }
    if (pressed != stablePressed && now - changedAt >= kButtonDebounceMs) {
      stablePressed = pressed;
      if (pressed) {
        microphoneMuted = !microphoneMuted;
        ++muteGeneration;
        // Do not mask UART interrupts while clearing the 10 KB capture ring:
        // that can drop bridge bytes. Generation tags discard stale blocks.
        memset(audioBlock, 0, sizeof(audioBlock));
        digitalWrite(kMuteLedPin, microphoneMuted ? HIGH : LOW);
      }
    }
    k_msleep(5);
  }
}


void captureSample(const struct device *, void *) {
  uint32_t now = k_cycle_get_32();
  if (capturedSamples) {
    uint32_t interval = now - previousSampleCycle;
    if (interval < minSampleCycles) minSampleCycles = interval;
    if (interval > maxSampleCycles) maxSampleCycles = interval;
  }
  previousSampleCycle = now;
  if (producedBlocks - consumedBlocks >= 16) { ++droppedBlocks; return; }
  if (capturePosition == 0) blockGeneration[producedBlocks % 16] = muteGeneration;
  const int raw = readMic();
  if (raw < 0) {
    ++adcTimeouts;
    return;
  }
  baselineQ8 += (((static_cast<long>(raw) << 8) - baselineQ8) >> 12);
  long centered = (raw - (baselineQ8 >> 8)) * kSoftwareGain;
  captureRing[producedBlocks % 16][capturePosition++] = microphoneMuted ? 0 : static_cast<int16_t>(constrain(centered, -32768L, 32767L));
  ++capturedSamples;
  if (capturePosition == kBlockSamples) {
    __DMB();
    ++producedBlocks;
    capturePosition = 0;
  }
}

void stopSampling() {
  if (timerReady) counter_stop(sampleTimer);
  producedBlocks = consumedBlocks = 0;
}

bool startSampling() {
  stopSampling();
  capturePosition = 0;
  capturedSamples = droppedBlocks = adcTimeouts = 0;
  minSampleCycles = UINT32_MAX;
  maxSampleCycles = 0;
  return counter_start(sampleTimer) == 0;
}

bool writeAll(const uint8_t *data, size_t length) {
  while (length > 0 && client->connected()) {
    const size_t written = client->write(data, length);
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

  if (client->connect(kAudioHost, kAudioPort) < 0) {
    Monitor.println("Connection failed; retrying");
    return false;
  }

  Monitor.println("Audio stream connected");
  const uint8_t keyLength = strlen(kAudioSharedKey);
  const uint8_t header[] = {'H', 'R', 'T', 'A', keyLength};
  if (!writeAll(header, sizeof(header)) ||
      !writeAll(reinterpret_cast<const uint8_t *>(kAudioSharedKey), keyLength)) {
    Monitor.println("Audio authentication header failed");
    resetAudioClient();
    return false;
  }
  return startSampling();
}

void setup() {
  pinMode(kMuteButtonPin, INPUT_PULLUP);
  pinMode(kMuteLedPin, OUTPUT);
  // Holding the button during power-up starts muted; otherwise start live.
  microphoneMuted = digitalRead(kMuteButtonPin) == LOW;
  digitalWrite(kMuteLedPin, microphoneMuted ? HIGH : LOW);
  k_thread_create(&muteThread, muteThreadStack,
                  K_THREAD_STACK_SIZEOF(muteThreadStack), pollMuteButton,
                  nullptr, nullptr, nullptr, K_PRIO_PREEMPT(5), 0, K_NO_WAIT);
  Bridge.begin(AUDIO_BRIDGE_BAUD);
  resetAudioClient();
  Monitor.begin(115200);
  analogReadResolution(kAdcBits);
  pinMode(kMicPin, INPUT);

  analogRead(kMicPin); // Initialize pin and ADC once.
  // The default A0 acquisition time is the maximum (814 ADC cycles).
  // The microphone output is buffered; use 36 cycles for audio-rate capture.
  LL_ADC_SetChannelSamplingTime(ADC1, LL_ADC_CHANNEL_9, LL_ADC_SAMPLINGTIME_36CYCLES);
  LL_ADC_DisableIT_EOC(ADC1);
  LL_ADC_DisableIT_EOS(ADC1);
  LL_ADC_DisableIT_OVR(ADC1);
  delay(1000);
  long total = 0;
  for (int i = 0; i < 256; ++i) {
    total += readMic();
  }
  baselineQ8 = (total / 256L) << 8;
  if (!device_is_ready(sampleTimer)) {
    Monitor.println("Audio timer is not ready");
    return;
  }
  uint32_t frequency = counter_get_frequency(sampleTimer);
  if (frequency < kSampleRate || frequency % kSampleRate != 0) {
    Monitor.println("Audio timer cannot produce exactly 16000 Hz");
    return;
  }
  counter_top_cfg config = {};
  // STM32 counts from zero through ARR, inclusive.
  config.ticks = frequency / kSampleRate - 1;
  config.callback = captureSample;
  timerReady = counter_set_top_value(sampleTimer, &config) == 0;
  // Let the 1-Mbaud bridge UART preempt ADC polling to avoid lost RPC bytes.
  NVIC_SetPriority(static_cast<IRQn_Type>(DT_IRQN(DT_PARENT(DT_NODELABEL(counter_servo)))), 7);
  Monitor.print("Audio timer frequency: "); Monitor.println(frequency);
}

void loop() {
  if (!timerReady) { delay(1000); return; }
  if (!client->connected()) {
    stopSampling();
    resetAudioClient();
    if (!connectToAsus()) {
      stopSampling();
      resetAudioClient();
      delay(2000);
      return;
    }
  }
  uint32_t waitStarted = millis();
  while (producedBlocks == consumedBlocks && !droppedBlocks && !adcTimeouts && millis() - waitStarted < 1000) delay(1);
  if (producedBlocks == consumedBlocks || droppedBlocks || adcTimeouts) {
    stopSampling();
    Monitor.println("Audio sampling failed or queue overflowed; reconnecting");
    resetAudioClient();
    return;
  }
  __DMB();
  const uint32_t generation = blockGeneration[consumedBlocks % 16];
  memcpy(audioBlock, captureRing[consumedBlocks % 16], sizeof(audioBlock));
  __DMB();
  ++consumedBlocks;
  if (microphoneMuted || generation != muteGeneration) memset(audioBlock, 0, sizeof(audioBlock));
  if (!writeAll(reinterpret_cast<const uint8_t *>(audioBlock), sizeof(audioBlock))) {
    stopSampling();
    Monitor.println("Audio connection lost");
    resetAudioClient();
    return;
  }
  static uint32_t lastReport = 0;
  if (millis() - lastReport >= 5000) {
    lastReport = millis();
    Monitor.print("Audio samples="); Monitor.print(capturedSamples);
    Monitor.print(" interval_cycles_min="); Monitor.print(minSampleCycles);
    Monitor.print(" max="); Monitor.print(maxSampleCycles);
    Monitor.print(" drops="); Monitor.print(droppedBlocks);
    Monitor.print(" adc_timeouts="); Monitor.println(adcTimeouts);
  }
}
