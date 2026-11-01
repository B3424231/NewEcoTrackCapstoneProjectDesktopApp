# EcoTrack setup artwork

Uses the existing `assets/ecoTrack.png` logo with EcoTrack's navy `#0b1220` and
green `#34d399`. The logo source is unchanged. Native Windows wizard controls
remain native; the header, welcome/finish imagery, icon and copy are branded.

Regenerate with Windows System.Drawing, without additional packages:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer-artwork.ps1 -Version 1.0.0
```

Build resources for the root electron-builder configuration:

| Option | Resource |
| --- | --- |
| `win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon` | `assets/installer/ecotrack.ico` |
| `nsis.installerHeader` | `assets/installer/installer-header.bmp` |
| `nsis.installerSidebar` | `assets/installer/installer-sidebar.bmp` |
| `nsis.uninstallerSidebar` | `assets/installer/uninstaller-sidebar.bmp` |
| `nsis.include` | `assets/installer/installer.nsh` |

Use an assisted wizard (`oneClick: false`). Set `deleteAppDataOnUninstall: false`
so the uninstaller's data-retention text matches its behaviour.

Header: 150 x 57, 24-bit BMP. Sidebars: 164 x 314, 24-bit BMP. The ICO contains
16, 24, 32, 48, 64, 128 and 256 pixel PNG-compressed images. Adjacent PNGs are
review previews; only the ICO, BMP and NSIS include are required by the builder.

NSIS page-image and welcome-copy options follow the installed electron-builder
templates and [Modern UI 2 documentation](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html).

`artwork-preview.png` shows both sidebars enlarged for inspection. Actual
installation, upgrade and uninstall verification belongs to the final package
tests; the preview alone does not prove those workflows.
