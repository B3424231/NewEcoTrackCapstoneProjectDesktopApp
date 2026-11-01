/* Shared presentation helpers. No state, storage, network or device operations. */
(function (root) {
'use strict';
function ecoEscapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
// Display functional names while preserving raw identifiers for transport.
function ecoDeviceDisplayName(value) {
  const text = String(value || '').trim();
  if (!text) return 'AC device';
  if (/^(?:EcoTrack[-_])?(?:esp32(?:s3)?|heltec)[-_:]/i.test(text)) return 'AC device ' + text.split(/[-_]/).at(-1).slice(-6).toUpperCase();
  return text.replace(/\b(?:ESP32(?:[- ]?S3)?|Heltec(?: V3)?|MCP9808|MPX5010DP|LM393(?:DR)?|SX1262|2N2222?A?)\b/gi, 'device');
}
// Identifier fields retain their complete saved value; friendly-name rules do not apply.
function ecoDeviceIdentifier(node, profiles = []) {
  const hardwareId = typeof node?.node_id === 'string' ? node.node_id.trim() : '';
  const databaseIds = [node?.db_id, node?.pb_id].filter(Boolean);
  const linked = profiles.filter(profile => hardwareId && profile.node_id === hardwareId ||
    databaseIds.some(id => profile.controller_node_id === id) ||
    node?.monitor_aircon_id && (profile.aircon_id || profile.id) === node.monitor_aircon_id);
  const canonicalId = linked.length === 1 && typeof linked[0].device_id === 'string' ? linked[0].device_id.trim() : '';
  return canonicalId || hardwareId || 'Unavailable';
}
root.ecoDeviceDisplayName = ecoDeviceDisplayName;
root.ecoDeviceIdentifier = ecoDeviceIdentifier;
root.ecoEscapeHtml = ecoEscapeHtml;
})(window);
