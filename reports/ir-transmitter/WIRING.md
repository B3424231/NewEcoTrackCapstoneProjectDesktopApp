# IR receiver and transmitter module

Updated sketch: `../cloud-hardware/EcoTrackCloudReceiver.ino.txt`, version `cloud-ir-controller-1.3-rxtx`. This is a copy-paste Arduino sketch; the existing firmware directory is unchanged.

## Connections

| Part | Connection |
| --- | --- |
| IR receiver OUT | ESP32-S3 GPIO 4 (`IR_RX_PIN`) |
| IR transmitter module S / IN | ESP32-S3 GPIO 5 (`IR_TX_PIN`) |
| Receiver and transmitter GND | ESP32 GND |
| Receiver VCC | 3.3V, for the compatible receiver already in use |
| Transmitter VCC | Its manufacturer's rated supply; use a module accepting a 3.3V control signal |

Read the labels on your module rather than assuming the pin order. A supply rating is separate from its signal-input rating. Do not apply a 5V signal to the ESP32 GPIO. The board's pin positions are shown in [Heltec's V3 pin map](https://resource.heltec.cn/download/Wireless_Stick_Lite_V3/HTIT-WSL_V3.png); the library's [IR sending reference](https://github.com/crankyoldgit/IRremoteESP8266/wiki#ir-sending) explains the sending hardware.

```cpp
constexpr uint16_t IR_RX_PIN = 4;
constexpr uint16_t IR_TX_PIN = 5;
constexpr bool IR_TX_ENABLED = true;
constexpr bool IR_TX_INVERTED = false;
constexpr int16_t IR_AC_MODEL = -1;
```

Set `IR_TX_INVERTED` to true for an active-low transmitter module. Both GPIOs are configurable and must be different. Set `IR_TX_ENABLED` to false until the transmitter is connected if you want monitoring alone. The capability flag declares the configured transmitter; the ESP32 cannot electrically verify its presence or confirm an AC's response.

## Upload and use

1. Copy the whole updated sketch into Arduino IDE, select Heltec Wireless Stick Lite(V3), and upload. Dependencies remain ESP32 core 3.3.12, ArduinoJson 7.4.3 and IRremoteESP8266 2.9.0.
2. Restart EcoTrack from this project. Existing Wi-Fi and cloud credentials stay in the same ESP32 preferences namespace. Complete Bluetooth/cloud registration if they were deleted or invalid.
3. Wait for an online Supabase heartbeat reporting `ir_transmitter: true`. Controls become available from the reported capability rather than a manually editable status.
4. Detect the physical AC remote or select its exact supported protocol in Edit / IR Profiles. Brand aliases cover the existing supported families; exact variants such as DAIKIN64 are kept. Generic or unsupported protocols fail visibly, rather than choosing a guessed encoder for an unrelated brand.
5. Point the transmitter at the AC and use Aircon Control or Protocol Studio to send power, temperature, mode or fan settings. Existing swing/turbo/eco settings and AC sleep flags travel in the complete state when applicable.
6. Command delivery progresses from Queued to Transmitted only after the board's acknowledgement. Transmitted means the IR library accepted/attempted emission; physical AC operation remains unconfirmed.

The receiver is paused while emitting IR and briefly afterward, so the outgoing command is not saved as a physical-remote observation. Logical previous IR state is retained across resets and updated by decoded remote signals to support protocols with toggle semantics. A saved logical state still cannot establish the AC's physical state.

ESP32 wake/sleep schedules continue through Control Schedules. They are separate from an AC remote's sleep feature. The transmitter GPIO is held at its inactive level during deep sleep. Wi-Fi/Bluetooth are unavailable during deep sleep; reset the board for an immediate restart.

No Wi-Fi credentials, battery readings, sensor values or measured AC power were added.
