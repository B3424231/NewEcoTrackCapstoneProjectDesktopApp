The dashboard card now displays the saved controller display name in its heading and footer. Its subtitle contains only the AC type, removing the duplicate Matrix profile/manufacturer text. A controller whose name is still the generated ESP32 identifier displays AC Controller until the admin supplies a custom name through Edit Device.

Both initial rendering and in-place updates use the same textContent mapping. Custom names are rendered as text. Card IDs, control links and hardware command targets retain their existing stable identities. Database names, manufacturer data and firmware were not modified.

Validation observed:
- Six-page integration: 41 checks passed.
- Hidden native Chromium: 7 scenario groups passed, including actual initial card markup, a saved controller name edit, generated-ID fallback and stable command targeting.
- Project npm test: 34 checks passed.
- Command/audit renderer and handlers match the pre-change SHA-256.

The native checks use local fixtures; physical hardware was not tested for this presentation change.
