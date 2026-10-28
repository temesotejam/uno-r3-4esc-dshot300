/*
 * Uno R3 (ATmega328P, 16 MHz) - potentiometer to FOUR simultaneous DShot300 outputs.
 * All four ESCs receive the same throttle value and DShot frame at the same time.
 *
 * Connection:
 *   10k potentiometer: one end -> Uno 5V, other end -> Uno GND,
 *                      center (wiper) -> A0.
 *   Uno D8 / PB0 -> ESC 1 signal
 *   Uno D9 / PB1 -> ESC 2 signal
 *   Uno D10 / PB2 -> ESC 3 signal
 *   Uno D11 / PB3 -> ESC 4 signal
 *   Uno GND -> all ESC signal GNDs (common ground).
 *   Supply the ESC separately using its compatible battery (e.g. 1S LiPo).
 *   Optional status LED on D7 through a series resistor to GND.
 *
 * IMPORTANT: REMOVE ALL PROPELLERS for bench testing.
 * DShot=0 means a STOP command, NOT a physical power cut.
 * Check that your ESC accepts the Uno's 5V digital signal level.
 * Four identical outputs are switched in hardware together by a single PORTB write.
 * The transmitter writes ALL of PORTB; D12/D13 may not be used for other signals.
 * UNO's built-in D13 LED is not a usable status indicator in this sketch.
 *
 * DShot300 waveform based on the earlier working UnoR3_DShot300_StartHold_
 * UpDown10s sketch (which credits bird-sanctuary/arduino-bi-directional-dshot).
 * GPL-3.0: see LICENSE.
 */

#include <Arduino.h>
#include <avr/io.h>

#if !defined(__AVR_ATmega328P__) || F_CPU != 16000000UL
#error "Arduino Uno R3 (ATmega328P, 16 MHz) is required."
#endif

#define DELAY_CYCLES(n) __builtin_avr_delay_cycles(n)

// ===== User-adjustable options =====
const uint8_t POT_PIN = A0;
const uint8_t DSHOT_PIN_FIRST = 8;
const uint8_t DSHOT_PIN_LAST = 11;
// PORTB bit0..3 == Uno D8, D9, D10, D11. Each ESC gets SAME DShot frame.
const uint8_t FOUR_ESC_MASK = 0b00001111;
const uint8_t STATUS_LED_PIN = 7;

// Start at 250 to avoid unreliable operation at very low DShot values.
// Change to 48 if you want the entire standard motor-throttle range.
const uint16_t MIN_RUNNING_DSHOT = 250;
const uint16_t MAX_RUNNING_DSHOT = 2047;

// Slightly different thresholds add hysteresis near the OFF position.
const uint16_t POT_STOP_ADC = 40;    // 0..40 -> STOP immediately
const uint16_t POT_START_ADC = 58;   // >=58 required to leave STOP
const uint32_t INITIAL_STOP_MS = 3000;
const uint32_t LOW_CONFIRM_MS = 600;
const uint32_t ADC_INTERVAL_US = 10000;   // 100 Hz sampling
const uint32_t DSHOT_INTERVAL_US = 2000;  // 500 Hz DShot frames
const uint32_t REPORT_INTERVAL_MS = 250;
const uint16_t SLEW_UP_STEP = 45;    // max change per 10 ms sample
const uint16_t SLEW_DOWN_STEP = 90;  // faster downward response
// ===== End options =====

uint32_t startMs = 0;
uint32_t lastAdcUs = 0;
uint32_t lastDshotUs = 0;
uint32_t lastReportMs = 0;
uint32_t lowStartMs = 0;
uint16_t rawAdc = 0;
uint16_t filteredAdc = 0;
uint16_t dshotCommand = 0;
bool potFilterInitialized = false;
bool lowTiming = false;
bool enabled = false;
bool runRequested = false;

uint16_t makeDshotFrame(uint16_t value) {
  if (value > 2047) value = 2047;
  const uint16_t payload = (uint16_t)(value << 1); // telemetry request = 0
  const uint8_t checksum = (payload ^ (payload >> 4) ^ (payload >> 8)) & 0x0f;
  return (uint16_t)((payload << 4) | checksum);
}

// Preserve DShot300 timing from the previous working Uno sketch.
// Because this assigns ALL of PORTB, D12..D13 are unavailable.
static inline void sendDshot300Bit(bool one) {
  if (one) {
    PORTB = FOUR_ESC_MASK;
    DELAY_CYCLES(37);
    PORTB = 0b00000000;
    DELAY_CYCLES(7);
  } else {
    PORTB = FOUR_ESC_MASK;
    DELAY_CYCLES(16);
    PORTB = 0b00000000;
    DELAY_CYCLES(25);
  }
}

void sendDshot300Frame(uint16_t frame) {
  for (uint8_t i = 0; i < 16; i++) {
    sendDshot300Bit((frame & 0x8000u) != 0);
    frame <<= 1;
  }
}

uint16_t adcToDshot(uint16_t adc) {
  if (adc < POT_START_ADC) adc = POT_START_ADC;
  if (adc > 1023) adc = 1023;
  const uint32_t numerator = (uint32_t)(adc - POT_START_ADC)
                           * (MAX_RUNNING_DSHOT - MIN_RUNNING_DSHOT);
  return (uint16_t)(MIN_RUNNING_DSHOT
         + numerator / (1023u - POT_START_ADC));
}

void updateFromPot(uint32_t nowMs) {
  rawAdc = (uint16_t)analogRead(POT_PIN);
  if (!potFilterInitialized) {
    filteredAdc = rawAdc;
    potFilterInitialized = true;
  } else {
    // Smooth the potentiometer's ADC noise (approx. 40 ms time constant).
    filteredAdc = (uint16_t)((3UL * filteredAdc + rawAdc + 2UL) / 4UL);
  }

  if ((uint32_t)(nowMs - startMs) < INITIAL_STOP_MS) {
    enabled = false;
    lowTiming = false;
    runRequested = false;
    dshotCommand = 0;
    return;
  }

  // Startup interlock: user must deliberately hold the pot at zero.
  if (!enabled) {
    dshotCommand = 0;
    runRequested = false;
    if (rawAdc <= POT_STOP_ADC) {
      if (!lowTiming) {
        lowTiming = true;
        lowStartMs = nowMs;
      }
      if ((uint32_t)(nowMs - lowStartMs) >= LOW_CONFIRM_MS) enabled = true;
    } else {
      lowTiming = false;
    }
    return;
  }

  // Always act on raw zero immediately, independent of the smoothing filter.
  if (rawAdc <= POT_STOP_ADC) {
    runRequested = false;
    dshotCommand = 0;
    return;
  }

  // Hysteresis prevents motor start/stop chatter at the zero position.
  if (!runRequested && filteredAdc >= POT_START_ADC) runRequested = true;
  if (!runRequested) {
    dshotCommand = 0;
    return;
  }

  const uint16_t target = adcToDshot(filteredAdc);
  if (dshotCommand < MIN_RUNNING_DSHOT) {
    // Do not emit DShot 1..47 (special commands) during an acceleration ramp.
    dshotCommand = MIN_RUNNING_DSHOT;
  } else if (target > dshotCommand) {
    uint16_t delta = target - dshotCommand;
    if (delta > SLEW_UP_STEP) delta = SLEW_UP_STEP;
    dshotCommand += delta;
  } else if (target < dshotCommand) {
    uint16_t delta = dshotCommand - target;
    if (delta > SLEW_DOWN_STEP) delta = SLEW_DOWN_STEP;
    dshotCommand -= delta;
  }
}

void setup() {
  for (uint8_t pin = DSHOT_PIN_FIRST; pin <= DSHOT_PIN_LAST; ++pin) {
    pinMode(pin, OUTPUT);
  }
  PORTB = 0; // unidirectional DShot idle = LOW
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  Serial.begin(115200);
  startMs = millis();
  lastAdcUs = micros() - ADC_INTERVAL_US;
  lastDshotUs = micros() - DSHOT_INTERVAL_US;
  Serial.println(F("Uno R3 | A0 potentiometer -> DShot300 on D8 D9 D10 D11"));
  Serial.println(F("REMOVE PROPELLERS. ESC power is independent of Uno."));
  Serial.println(F("Boot: STOP 3s, then hold potentiometer at minimum 0.6s."));
  Serial.println(F("Turn knob to adjust. Turn all the way down to STOP."));
}

void loop() {
  uint32_t nowUs = micros();
  if ((uint32_t)(nowUs - lastAdcUs) >= ADC_INTERVAL_US) {
    lastAdcUs = nowUs;
    updateFromPot(millis());
  }

  // Keep sending STOP frames, even if the potentiometer is at zero.
  nowUs = micros();
  if ((uint32_t)(nowUs - lastDshotUs) >= DSHOT_INTERVAL_US) {
    lastDshotUs = nowUs;
    const uint16_t frame = makeDshotFrame(dshotCommand);
    noInterrupts();
    sendDshot300Frame(frame);
    interrupts();
  }

  // Status LED indicates nonzero ESC command, not merely software armed state.
  digitalWrite(STATUS_LED_PIN, dshotCommand > 0 ? HIGH : LOW);

  const uint32_t nowMs = millis();
  if ((uint32_t)(nowMs - lastReportMs) >= REPORT_INTERVAL_MS) {
    lastReportMs = nowMs;
    Serial.print(F("A0="));
    Serial.print(rawAdc);
    Serial.print(F(" DShot="));
    Serial.print(dshotCommand);
    Serial.print(F(" enabled="));
    Serial.println(enabled ? 1 : 0);
  }
}
