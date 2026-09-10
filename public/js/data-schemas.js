// ===================================================================
// ECOTRACK DATA SCHEMAS
// Pure type definitions and schema signatures (mock generators removed)
// ===================================================================

/**
 * @typedef {Object} TelemetryPacket
 * @property {string} id - PocketBase record ID
 * @property {string} node_id - AC Sensor IDentifier (e.g., "node-1")
 * @property {number} temperature - Temperature in °C
 * @property {number} pressure - Atmospheric pressure in kPa
 * @property {number} rssi - Signal strength in dBm (negative)
 * @property {number} battery - Battery voltage in V
 * @property {string} status - "online" | "offline"
 * @property {string} created - ISO timestamp
 */

/**
 * @typedef {Object} NodeData
 * @property {string} id - AC Sensor IDentifier
 * @property {string} name - Human-readable label
 * @property {string} room_id - The ID of the room this node belongs to
 * @property {number} temp - Current temperature in °C
 * @property {number} pressure - Current pressure in kPa
 * @property {number} rssi - Signal strength in dBm
 * @property {number} battery - Battery voltage in V
 * @property {string} status - "online" | "offline"
 * @property {string} [wakeTime] - Schedule: HH:MM
 * @property {string} [sleepTime] - Schedule: HH:MM
 * @property {number} [intervalVal] - Transmission interval value
 * @property {string} [intervalUnit] - "Seconds" | "Minutes" | "Hours"
 */

/**
 * @typedef {Object} RoomData
 * @property {string} id - PocketBase record ID
 * @property {string} name - Room name
 * @property {number} node_limit - Maximum number of nodes
 * @property {string} created - ISO timestamp
 */

/**
 * @typedef {Object} RuleData
 * @property {number|string} id - Local rule ID
 * @property {string} [pbId] - PocketBase record ID
 * @property {"temperature"|"battery"} type - Rule type
 * @property {"above"|"below"|"equals"} condition - Evaluation condition
 * @property {number} value - Threshold value
 * @property {string} unit - "°C" | "°F" | "%"
 * @property {boolean} enabled - Active flag
 * @property {string} message - Alert message
 * @property {string} [room] - Room ID (temperature rules)
 * @property {string} [roomName] - Denormalized room name
 * @property {string[]} [nodes] - Target AC Sensor IDs (temperature rules)
 * @property {string[]} [nodeNames] - Denormalized AC Sensor Names
 * @property {string} [node] - Single AC Sensor ID (battery rules)
 * @property {string} [nodeName] - Denormalized AC Sensor Name
 * @property {number} [duration] - Duration in minutes (temperature rules)
 * @property {string|null} [startDate] - Optional YYYY-MM-DD
 * @property {string|null} [startTime] - Optional HH:MM
 * @property {string|null} [endDate] - Optional YYYY-MM-DD
 * @property {string|null} [endTime] - Optional HH:MM
 */

/**
 * @typedef {Object} NotificationData
 * @property {string} [pbId] - PocketBase record ID
 * @property {number|string} id - Local internal ID
 * @property {number} [id_internal] - Timestamp-based internal ID
 * @property {string} time - HH:MM format
 * @property {string} date - YYYY-MM-DD format
 * @property {string} content - Message body
 * @property {string} room - Room ID or name
 * @property {boolean} triggered - Whether notification has fired
 */

/**
 * @typedef {Object} SystemConfig
 * @property {{eco: number, cool: number, cold: number}} ac_thresholds
 * @property {number} optimal_temp
 * @property {{sleep_hours: number, active_draw_ma: number, sleep_draw_ma: number}} power_settings
 * @property {{temp_critical: number, temp_warning: number, voltage_critical: number, voltage_warning: number, rssi_poor: number}} diagnostics_thresholds
 */

/**
 * @typedef {Object} DiagnosticAlert
 * @property {string} type - Alert type identifier
 * @property {string} message - Human-readable description
 * @property {"critical"|"warning"} severity - Severity level
 */

/**
 * @typedef {Object} SerialPortInfo
 * @property {string} port - Port name (e.g., "COM3")
 * @property {string} description - Device description
 * @property {string} hwid - Hardware ID
 * @property {number|null} vid - Vendor ID
 * @property {number|null} pid - Product ID
 * @property {string|null} manufacturer - Device manufacturer
 * @property {string|null} serial_number - Serial number
 * @property {string|null} location - USB location
 * @property {string|null} interface - Interface description
 */

// Safe empty stub for any backward-compatible callers
const MockDataGenerator = {
  generateFullDataset: () => ({ nodes: [], rooms: [], telemetry: [], rules: [], notifications: [] }),
  generateSerialPorts: () => []
};

// Make available globally if needed
if (typeof window !== 'undefined') {
  window.MockDataGenerator = MockDataGenerator;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MockDataGenerator;
}
