Arduino Uno R3 + 1 potentiometer -> 4 ESCs (simultaneous DShot300)
===============================================================

[Connection]
  10 kOhm potentiometer:
    outer pin 1 -> Uno 5V
    center wiper -> Uno A0
    outer pin 2 -> Uno GND

  Uno D8  (PB0) -> ESC #1 signal
  Uno D9  (PB1) -> ESC #2 signal
  Uno D10 (PB2) -> ESC #3 signal
  Uno D11 (PB3) -> ESC #4 signal
  Uno GND -> all 4 ESC grounds (common GND)
  Separate compatible LiPo supply -> ESC power (+/-)
  Optional Uno D7 -> resistor (220-1000 ohm) -> LED -> GND

  The FOUR DShot300 outputs carry IDENTICAL commands, synchronized.
  The ESCs are not addressed individually or controlled at different speeds.
  The code writes the whole PORTB register (D8..D13). Keep D12 and D13
  unused; do not use SPI or the built-in D13 LED as status while it runs.
  Do not connect two ESC signal outputs together. One Uno pin per ESC input.
  Please verify all ESC signal pins tolerate 5V logic from Uno.

[Arduino IDE]
  1. Unzip the package.
  2. Open UnoR3_Potentiometer_4ESC_DShot300.ino in the like-named folder.
  3. Select "Arduino Uno" board and the right COM port.
  4. Upload. No extra libraries required.
  5. Optionally open the serial monitor at 115200bps to observe ADC and
     DShot values; all four channels use that same DShot value.

[Behavior]
  * Uno starts by sending DShot 0 (STOP) on all four outputs for 3 seconds.
  * After 3s, hold the knob fully down (A0 <= 40) for 0.6s to enable.
  * A0 <= 40 commands immediate STOP to all four ESCs.
  * To start, turn the knob until A0 reaches approx. 58; initial running
    command is DShot 250, then rises smoothly up to 2047.
  * A0 is sampled at 100Hz with simple filtering and output slew limits.
  * DShot is sent on all four outputs at 500 frames/sec; no eRPM receive.
  * D7 LED high indicates a nonzero throttle command for all four ESCs.
  * Turn the pot to zero at any time to command all ESCs to STOP.

[Configuration]
  Set MIN_RUNNING_DSHOT to 48 for the entire standard running range
  (the values 1..47 are reserved DShot commands and are never sent).
  Tune the POT_STOP_ADC, POT_START_ADC thresholds to your potentiometer.
  SLEW_UP_STEP/SLEW_DOWN_STEP limit changes every 10ms ADC update.

[IMPORTANT safety]
  - REMOVE ALL PROPELLERS during bench testing.
  - All four ESCs start together; check the 1S battery and wiring can handle
    their combined inrush/start currents without voltage drop/brownout.
  - A DShot=0 STOP request is not a power cut; provide an actual disconnect.
  - UNO cannot be powered directly from 1S LiPo on its 5V pin.
  - Common GND is essential for Uno and all ESC signal references.
  - DShot bit timing is retained from the previous user-tested Uno sketch,
    but waveforms for four simultaneous output pins were not measured here.

[License]
  GPL-3.0 is included (the prior example's DShot code is derived from
  the credited public implementation).
