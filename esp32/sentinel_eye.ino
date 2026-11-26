/* SentinelEye ESP32 firmware
   PIR sensor: OUT -> GPIO 14, VCC -> 5V/VIN, GND -> GND
   Active buzzer: signal/+ -> GPIO 26, GND/- -> GND
   Red LED: GPIO 27 -> 220 ohm resistor -> LED anode; LED cathode -> GND
   Update WIFI_SSID, WIFI_PASSWORD, and HELPER_URL before uploading.
*/
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* HELPER_URL = "http://192.168.1.10:8000/pir";

constexpr uint8_t PIR_PIN = 14;
constexpr uint8_t BUZZER_PIN = 26;
constexpr uint8_t LED_PIN = 27;
constexpr unsigned long ALARM_DURATION_MS = 10000UL;
constexpr unsigned long BLINK_INTERVAL_MS = 250UL;
constexpr unsigned long PIR_REPORT_GAP_MS = 3000UL;

WebServer server(80);
bool alarmActive = false;
bool ledState = false;
unsigned long alarmStartedAt = 0;
unsigned long lastBlinkAt = 0;
unsigned long lastPirReportAt = 0;
unsigned long bootedAt = 0;
unsigned long lastPirAt = 0;
uint32_t pirEvents = 0;

void startAlarm() {
  alarmActive = true;
  alarmStartedAt = millis();
  lastBlinkAt = 0;
  ledState = false;
  digitalWrite(BUZZER_PIN, HIGH);
  digitalWrite(LED_PIN, LOW);
}

void stopAlarm() {
  alarmActive = false;
  ledState = false;
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
}

void handleIntrusion() {
  startAlarm();
  server.send(200, "application/json", "{\"ok\":true,\"alarm\":true,\"timeout_seconds\":10}");
}

void handleStop() {
  stopAlarm();
  server.send(200, "application/json", "{\"ok\":true,\"alarm\":false}");
}

void handleStatus() {
  const unsigned long remaining = alarmActive && millis() - alarmStartedAt < ALARM_DURATION_MS
    ? (ALARM_DURATION_MS - (millis() - alarmStartedAt) + 999UL) / 1000UL : 0;
  String body = "{\"online\":true,\"alarm\":";
  body += alarmActive ? "true" : "false";
  body += ",\"uptime\":" + String((millis() - bootedAt) / 1000UL);
  body += ",\"pir\":" + String(digitalRead(PIR_PIN) == HIGH ? "true" : "false");
  body += ",\"pir_events\":" + String(pirEvents);
  body += ",\"last_pir\":" + String(lastPirAt ? (lastPirAt / 1000UL) : 0);
  body += ",\"remaining_seconds\":" + String(remaining) + "}";
  server.send(200, "application/json", body);
}

void notifyHelper() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setConnectTimeout(1200);
  http.setTimeout(1500);
  http.begin(HELPER_URL);
  http.addHeader("Content-Type", "application/json");
  const String payload = "{\"type\":\"pir\",\"source\":\"esp32\",\"timestamp\":" + String(millis() / 1000UL) + "}";
  const int code = http.POST(payload);
  if (code < 200 || code >= 300) {
    Serial.printf("Helper POST failed: %d\n", code);
  } else {
    Serial.printf("PIR event reported to helper (%d)\n", code);
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  stopAlarm();
  bootedAt = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');
  }
  Serial.printf("\nSentinelEye IP: %s\n", WiFi.localIP().toString().c_str());

  server.on("/intrusion", HTTP_POST, handleIntrusion);
  server.on("/intrusion", HTTP_GET, handleIntrusion);
  server.on("/stop", HTTP_POST, handleStop);
  server.on("/stop", HTTP_GET, handleStop);
  server.on("/status", HTTP_GET, handleStatus);
  server.onNotFound([]() { server.send(404, "application/json", "{\"error\":\"not_found\"}"); });
  server.begin();
  Serial.println("HTTP server listening on port 80");
}

void loop() {
  server.handleClient();
  const unsigned long now = millis();

  if (digitalRead(PIR_PIN) == HIGH && now - lastPirReportAt >= PIR_REPORT_GAP_MS) {
    lastPirReportAt = now;
    lastPirAt = now;
    ++pirEvents;
    Serial.println("PIR motion detected");
    notifyHelper();
  }

  if (alarmActive && now - alarmStartedAt >= ALARM_DURATION_MS) {
    stopAlarm();
    Serial.println("Alarm timed out after 10 seconds");
  }

  if (alarmActive && now - lastBlinkAt >= BLINK_INTERVAL_MS) {
    lastBlinkAt = now;
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState ? HIGH : LOW);
  }
}
