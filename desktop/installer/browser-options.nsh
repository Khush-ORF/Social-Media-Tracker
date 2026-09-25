!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var TrackerBrowser
  Var TrackerBrowserAuto
  Var TrackerBrowserEdge
  Var TrackerBrowserChrome
  Var TrackerBrowserFull

  Function TrackerBrowserPage
    !insertmacro MUI_HEADER_TEXT "Collection browser" "Choose the browser used to collect public counts."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateRadioButton} 0 4u 100% 20u "Automatic - use an installed Edge or Chrome"
    Pop $TrackerBrowserAuto
    ${NSD_CreateRadioButton} 0 28u 100% 20u "Prefer Microsoft Edge (Chrome as backup)"
    Pop $TrackerBrowserEdge
    ${NSD_CreateRadioButton} 0 52u 100% 20u "Prefer Google Chrome (Edge as backup)"
    Pop $TrackerBrowserChrome
    ${NSD_CreateRadioButton} 0 76u 100% 26u "Full support - download Playwright Chromium during setup"
    Pop $TrackerBrowserFull
    ${NSD_CreateLabel} 0 110u 100% 32u "Full support requires internet access and additional disk space. Automatic uses an existing browser and needs no browser download."
    Pop $0
    ${If} $TrackerBrowser == "edge"
      ${NSD_Check} $TrackerBrowserEdge
    ${ElseIf} $TrackerBrowser == "chrome"
      ${NSD_Check} $TrackerBrowserChrome
    ${ElseIf} $TrackerBrowser == "playwright"
      ${NSD_Check} $TrackerBrowserFull
    ${Else}
      ${NSD_Check} $TrackerBrowserAuto
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function TrackerBrowserLeave
    StrCpy $TrackerBrowser "auto"
    ${NSD_GetState} $TrackerBrowserEdge $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $TrackerBrowser "edge"
    ${EndIf}
    ${NSD_GetState} $TrackerBrowserChrome $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $TrackerBrowser "chrome"
    ${EndIf}
    ${NSD_GetState} $TrackerBrowserFull $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $TrackerBrowser "playwright"
    ${EndIf}
  FunctionEnd
!endif

!macro customInit
  StrCpy $TrackerBrowser "auto"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/BROWSER=" $R1
  ${If} $R1 == "edge"
  ${OrIf} $R1 == "chrome"
  ${OrIf} $R1 == "playwright"
    StrCpy $TrackerBrowser $R1
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom TrackerBrowserPage TrackerBrowserLeave
!macroend

!macro customInstall
  ${If} $TrackerBrowser == "playwright"
    SetDetailsPrint both
    DetailPrint "Downloading the collection browser. This may take several minutes..."
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\install-browser.ps1" -ExecutablePath "$INSTDIR\${APP_EXECUTABLE_FILENAME}" -RuntimePath "$INSTDIR\resources\runtime" -BrowserPath "$INSTDIR\resources\browsers"'
    Pop $0
    ${If} $0 != "0"
      StrCpy $TrackerBrowser "auto"
      DetailPrint "Browser download failed. Automatic Edge/Chrome selection remains available."
      MessageBox MB_OK|MB_ICONEXCLAMATION "The optional browser download failed. The app is installed with automatic Edge/Chrome support. Rerun setup with Full support to retry." /SD IDOK
    ${EndIf}
  ${EndIf}
  FileOpen $0 "$INSTDIR\tracker-settings.json" w
  FileWrite $0 '{$\"browser$\":$\"$TrackerBrowser$\"}'
  FileClose $0
!macroend
