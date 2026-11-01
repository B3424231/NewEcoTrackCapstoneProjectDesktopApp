; EcoTrack branding only. Native NSIS controls retain keyboard and screen-reader support.
; Keep deleteAppDataOnUninstall=false in electron-builder; no data deletion is added here.

!macro customHeader
  BrandingText "EcoTrack | Aircon monitoring and control"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to EcoTrack"
  !define MUI_WELCOMEPAGE_TEXT "Set up EcoTrack for aircon monitoring and control.$\r$\n$\r$\nAfter installation, sign in to connect to your EcoTrack workspace.$\r$\n$\r$\nAn internet connection is required for shared desktop and mobile data.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Uninstall EcoTrack"
  !define MUI_WELCOMEPAGE_TEXT "Remove the EcoTrack desktop application from this computer.$\r$\n$\r$\nYour local history and settings will be retained.$\r$\n$\r$\nShared cloud records and mobile data will not be deleted.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
