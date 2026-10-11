# EcoTrack ESP32-S3 AC Controller Node Firmware Guide

This directory contains the production firmware for the **EcoTrack ESP32-S3 Universal Aircon IoT Controller Node** (`ecotrack_esp32_s3.ino`).

---

## 1. Key Capabilities & Architecture

- **38kHz Infrared Blaster (AC Transmitter)**: Emits high-power 38kHz modulated command pulse trains (GPIO 4 via 2N2222 transistor driver) for Koppel, Midea, Gree, Daikin, Panasonic, and custom RAW codes.
- **38kHz Infrared Demodulator (Remote Signal Learner)**: Listens on GPIO 5 via VS1838B demodulator to capture and learn button pulses from physical remotes.
- **Dual-Band (2.4 GHz + 5.0 GHz) Wi-Fi Compatibility**:
  - **Band Steering / Unified SSIDs**: Automatically associates with the 2.4 GHz BSSID channel of dual-band home and enterprise routers.
  - **Intelligent Dual-Band Suffix Fallback**: Automatically recognizes `_5G`, `_5GHz`, `-5G` SSIDs and falls back to the corresponding 2.4 GHz / base SSID if the 5 GHz band is not directly reachable by the 2.4 GHz RF radio.
  - **Dual-SSID Redundancy**: Supports Primary and Backup Wi-Fi network credentials with auto-failover and persistent storage in flash memory (NVS).
- **Bluetooth Low Energy (BLE 5.0) GATT Server**:
  - Wireless mobile app commissioning (SSID and password injection).
  - Direct offline AC command triggering (`BLE_CHAR_IR_TRIGGER_UUID`).
  - Real-time connection feedback (0=Idle, 1=Connecting, 2=Connected, 3=Error).
- **Supabase Cloud REST Integration**:
  - Real-time AC command polling from the `aircons` table.
  - Scheduled telemetry heartbeat (`temp`, `battery`, `rssi`, `status`, `aircon_type`) to `telemetry` and `nodes` tables (with air pressure removed).
- **Power & Battery Subsystem**:
  - Multi-sample ADC battery monitoring on GPIO 1.
  - TP4056 hardware charging (`CHRG` on GPIO 6) and standby (`STDBY` on GPIO 7) evaluation.
  - Dual-LED visual indicators (Red = Charging / Low battery alert; Green = Fully charged / Heartbeat).
- **Local Diagnostic HTTP Server**: High-speed ping responder on port 80 for sub-millisecond local network diagnostic probing.

---

## 2. Arduino IDE Setup Instructions

### Step 1: Install ESP32 Board Package
1. Open **Arduino IDE** (v2.x recommended).
2. Go to **File -> Preferences**.
3. In **Additional boards manager URLs**, add:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
4. Go to **Tools -> Board -> Boards Manager**, search for `esp32` by Espressif Systems, and click **Install**.

### Step 2: Install Libraries
1. In Arduino IDE, go to **Tools -> Manage Libraries...**
2. Search for `ArduinoJson` by Benoit Blanchon and click **Install** (v6.x or v7.x).
3. *(Optional)* Install `IRremoteESP8266`. If not installed, the firmware automatically falls back to its built-in, zero-dependency 38kHz PWM bit-banging engine.

### Step 3: Board Settings (Tools Menu)
- **Board**: `ESP32S3 Dev Module`
- **USB CDC On Boot**: `Enabled` (Required for Serial monitor over native USB)
- **CPU Frequency**: `240MHz (WiFi)`
- **Flash Mode**: `QIO 80MHz`
- **Flash Size**: `4MB (32Mb)` or `8MB` / `16MB`
- **Partition Scheme**: `Default 4MB with spiffs` or `Huge APP (3MB No OTA)`
- **PSRAM**: `OPI PSRAM` or `QSPI PSRAM` (matches your hardware module)
- **Port**: Select your ESP32-S3 COM port.

### Step 4: Uploading
1. Click the **Upload** button (`Ctrl + U`).
2. Open **Serial Monitor** at baud rate `115200`.
3. You will see:
   ```
   =========================================================
      ECOTRACK SMART AIRCON IOT CONTROLLER NODE (ESP32-S3)  
      Node Identity   : node_xxxxxx (AC Controller Node 101)
      Device Type     : AC Controller (IR Blaster + Demodulator Receiver)
      Wi-Fi Bands     : 2.4 GHz + 5.0 GHz Dual-Band Compatibility
      IR Hardware     : TX -> GPIO 4 | RX -> GPIO 5
   =========================================================
   ```

---

## 3. Mobile App Pairing & Control Flow
1. Open the EcoTrack Mobile App and navigate to **Device Management**.
2. Tap **+ Add Device / Provision Controller**.
3. The app scans and connects to `EcoTrack-AC-node_xxxxxx` over BLE.
4. Input your Wi-Fi credentials (supports 2.4GHz, 5GHz, and dual-band routers).
5. The ESP32-S3 connects, saves credentials to NVS, registers with Supabase, and begins processing AC commands.
