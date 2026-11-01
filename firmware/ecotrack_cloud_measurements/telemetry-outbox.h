#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <esp_partition.h>
#include <vector>
#include <algorithm>

// Each fully flushed file is one immutable, CRC-checked reading. Atomic rename
// commits append; only an explicit cloud acknowledgement may remove a reading.
class TelemetryOutbox {
 public:
  static constexpr size_t CAPACITY = 1024;
  struct Identity { uint32_t boot, sequence; };
  bool ready = false;
  String error;
  std::vector<Identity> entries;

  bool begin() {
    if (!LittleFS.begin(false)) {
      // Initialize only a provably erased partition. Never format existing data
      // after a mount/corruption failure.
      const esp_partition_t *part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs");
      bool erased = part != nullptr; uint8_t bytes[256];
      for (size_t at = 0; erased && at < part->size; at += sizeof(bytes)) {
        size_t amount = (part->size - at < sizeof(bytes) ? part->size - at : sizeof(bytes));
        if (esp_partition_read(part, at, bytes, amount) != ESP_OK) { erased = false; break; }
        for (size_t i = 0; i < amount; i++) if (bytes[i] != 0xff) { erased = false; break; }
      }
      if (!erased || !LittleFS.format() || !LittleFS.begin(false)) {
        error = "Measurement storage unavailable; existing flash was preserved."; return false;
      }
    }
    if (!LittleFS.exists("/telemetry") && !LittleFS.mkdir("/telemetry")) {
      error = "Measurement queue folder unavailable."; return false;
    }
    File folder = LittleFS.open("/telemetry");
    if (!folder || !folder.isDirectory()) { error = "Measurement queue unavailable."; return false; }
    std::vector<String> recovery;
    for (File file = folder.openNextFile(); file; file = folder.openNextFile()) {
      String name = file.name(); name = name.substring(name.lastIndexOf('/') + 1);
      if (name.endsWith(".tmp")) recovery.push_back(String("/telemetry/") + name);
      else { Identity item; if (identity(name, item)) entries.push_back(item); }
      file.close();
    }
    folder.close();
    // Recover complete writes interrupted between flush and final rename.
    for (const String &temporary : recovery) {
      JsonDocument envelope; File file = LittleFS.open(temporary, "r");
      bool valid = file && !deserializeJson(envelope, file) && check(envelope);
      if (file) file.close();
      String final = temporary.substring(0, temporary.length() - 4) + ".json";
      Identity item;
      if (valid && !LittleFS.exists(final) && identity(final.substring(final.lastIndexOf('/') + 1), item) && LittleFS.rename(temporary, final)) entries.push_back(item);
    }
    std::sort(entries.begin(), entries.end(), [](const Identity &a, const Identity &b) { return a.boot == b.boot ? a.sequence < b.sequence : a.boot < b.boot; });
    ready = true; return true;
  }

  size_t pending() const { return entries.size(); }
  bool append(JsonDocument &reading, uint32_t boot, uint32_t sequence) {
    if (!ready) return false;
    if (entries.size() >= CAPACITY || LittleFS.totalBytes() < LittleFS.usedBytes() + 32768) {
      error = "Measurement queue full; unconfirmed readings retained."; return false;
    }
    Identity item{boot, sequence}; String final = filename(item), temporary = final.substring(0, final.length() - 5) + ".tmp";
    if (LittleFS.exists(final)) { error = "Measurement identity already queued."; return false; }
    JsonDocument envelope; envelope["reading"].set(reading.as<JsonVariantConst>());
    String payload; serializeJson(envelope["reading"], payload); envelope["crc"] = checksum(payload);
    File file = LittleFS.open(temporary, "w");
    if (!file) { error = "Unable to persist measurement."; return false; }
    const size_t expected = measureJson(envelope), written = serializeJson(envelope, file);
    file.flush(); file.close();
    if (written != expected || !LittleFS.rename(temporary, final)) { error = "Measurement write was not confirmed."; return false; }
    entries.push_back(item); error = ""; return true;
  }

  size_t batch(JsonArray readings, size_t limit = 20) {
    if (!ready) return 0;
    for (size_t i = 0; i < entries.size() && i < limit; i++) {
      JsonDocument envelope; File file = LittleFS.open(filename(entries[i]), "r");
      bool valid = file && !deserializeJson(envelope, file) && check(envelope);
      if (file) file.close();
      if (!valid || envelope["reading"]["sequence"].as<uint32_t>() != entries[i].sequence) {
        error = "Stored measurement needs attention; unconfirmed files retained."; break;
      }
      readings.add(envelope["reading"]);
    }
    return readings.size();
  }

  bool acknowledge(JsonArrayConst sent, JsonArrayConst acknowledged) {
    // A malformed or partial response never erases a queued reading.
    if (sent.size() != acknowledged.size()) { error = "Measurement acknowledgement incomplete."; return false; }
    for (size_t i = 0; i < sent.size(); i++) {
      if (!acknowledged[i].is<const char *>() || sent[i]["report_id"].as<String>() != acknowledged[i].as<String>()) {
        error = "Measurement acknowledgement did not match."; return false;
      }
    }
    for (size_t i = 0; i < acknowledged.size(); i++) {
      if (entries.empty() || !LittleFS.remove(filename(entries.front()))) {
        error = "Delivered measurement could not be removed locally; retry is safe."; return false;
      }
      entries.erase(entries.begin());
    }
    error = ""; return true;
  }
 private:
  static String filename(const Identity &item) {
    char name[48]; snprintf(name, sizeof(name), "/telemetry/%010lu-%010lu.json", (unsigned long)item.boot, (unsigned long)item.sequence); return String(name);
  }
  static bool identity(const String &name, Identity &result) {
    unsigned long boot, sequence; char extra;
    if (name.length() != 26 || sscanf(name.c_str(), "%10lu-%10lu.json%c", &boot, &sequence, &extra) != 2) return false;
    result = {uint32_t(boot), uint32_t(sequence)}; return true;
  }
  static uint32_t checksum(const String &value) {
    uint32_t crc = 0xffffffff;
    for (size_t i = 0; i < value.length(); i++) { crc ^= uint8_t(value[i]); for (int bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xedb88320UL & (0UL - (crc & 1))); }
    return ~crc;
  }
  static bool check(JsonDocument &envelope) {
    if (!envelope["reading"].is<JsonObject>() || !envelope["crc"].is<uint32_t>()) return false;
    String payload; serializeJson(envelope["reading"], payload);
    return checksum(payload) == envelope["crc"].as<uint32_t>();
  }
};
