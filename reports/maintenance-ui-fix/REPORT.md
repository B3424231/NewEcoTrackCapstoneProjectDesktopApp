# Maintenance UI repair

Fixed the supplied screenshot's blank inactive Reports tab, unreadable archive count, oversized empty archive card, and archived header count.

- Removed broad white-text overrides from maintenance tabs, retaining the existing dedicated active label/icon styles and light/dark themes.
- Inactive tabs use a readable foreground. The archive badge has its own contrasting foreground, background and minimum size.
- The archive card fits its content for empty/search-empty states; populated results retain the scrolling table. Narrow layouts scroll horizontally without crushing columns.
- Search with no results has distinct explanatory copy. Fixed `updateStats()` referencing an undefined `archivedStaff` variable.
- Incremented stylesheet and staff script versions so a reload uses the fixes.

Verification: inline page script parsing and staff JavaScript syntax passed. Executed the existing archive renderer and stats functions against empty, filtered-empty and populated states; checks passed. Existing report deletion regression passed.

Browser visual verification was blocked: the browser tool exited with `trusted Node process exited unexpectedly; kernel reset`. No after screenshot was produced. Reload the Maintenance page to apply the frontend changes.

No firmware files were changed. Arduino code requested separately is supplied in the chat.
