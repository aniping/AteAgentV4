Unicode True
RequestExecutionLevel admin
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef APP_FILE_VERSION
  !error "APP_FILE_VERSION is required"
!endif
!ifndef APP_ARCH
  !error "APP_ARCH is required"
!endif
!ifndef SOURCE_ROOT
  !error "SOURCE_ROOT is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef APP_ICON
  !error "APP_ICON is required"
!endif
!ifndef MAX_INSTALL_DIR_LENGTH
  !error "MAX_INSTALL_DIR_LENGTH is required"
!endif
Name "ATE Agent"
OutFile "${OUTPUT_FILE}"
Icon "${APP_ICON}"
InstallDir "$PROGRAMFILES64\ATEAgent"
InstallDirRegKey HKLM "Software\ATE Agent" "InstallDir"
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SetDatablockOptimize on
SetOverwrite on
ShowInstDetails show
ShowUninstDetails show
BrandingText "ATE Agent ${APP_VERSION} (${APP_ARCH})"
VIProductVersion "${APP_FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "ATE Agent"
VIAddVersionKey /LANG=1033 "FileDescription" "ATE Agent Windows Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 ATE Agent"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\ATE-Agent.exe"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetRegView 64
FunctionEnd

Function .onVerifyInstDir
  StrLen $0 $INSTDIR
  ${If} $0 > ${MAX_INSTALL_DIR_LENGTH}
    Abort
  ${EndIf}
FunctionEnd

Function StopATEAgent
  IfFileExists "$INSTDIR\stop-all-server.exe" use_current use_legacy
  use_current:
  ExecWait '"$INSTDIR\stop-all-server.exe" "$INSTDIR"'
  Goto done
  use_legacy:
  IfFileExists "$INSTDIR\stop-installed-server.exe" 0 done
  ExecWait '"$INSTDIR\stop-installed-server.exe" "$INSTDIR"'
  Sleep 500
  done:
FunctionEnd

Section "ATE Agent" SecMain
  SectionIn RO
  Call StopATEAgent
  SetShellVarContext all
  SetRegView 64

  Delete "$INSTDIR\stop-installed-server.exe"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\support"
  Delete "$INSTDIR\launcher.cjs"
  Delete "$INSTDIR\ate-agent.ico"
  Delete "$INSTDIR\ate-agent-44.png"
  Delete "$INSTDIR\ate-agent-150.png"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_ROOT}\*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\ATE Agent" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "DisplayName" "ATE Agent"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "Publisher" "ATE Agent"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "DisplayIcon" "$INSTDIR\ATE-Agent.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\ATE Agent"
  CreateShortcut "$SMPROGRAMS\ATE Agent\ATE Agent.lnk" "$INSTDIR\ATE-Agent.exe" "" "$INSTDIR\ATE-Agent.exe" 0 SW_SHOWNORMAL "" "ATE Agent"
  CreateShortcut "$SMPROGRAMS\ATE Agent\Uninstall ATE Agent.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\ATE Agent.lnk" "$INSTDIR\ATE-Agent.exe" "" "$INSTDIR\ATE-Agent.exe" 0 SW_SHOWNORMAL "" "ATE Agent"
SectionEnd

Section "Uninstall"
  Call un.StopATEAgent
  SetShellVarContext all
  SetRegView 64

  Delete "$DESKTOP\ATE Agent.lnk"
  Delete "$SMPROGRAMS\ATE Agent\ATE Agent.lnk"
  Delete "$SMPROGRAMS\ATE Agent\Uninstall ATE Agent.lnk"
  RMDir "$SMPROGRAMS\ATE Agent"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATE Agent"
  DeleteRegKey HKLM "Software\ATE Agent"
  RMDir /r /REBOOTOK "$INSTDIR"
SectionEnd

Function un.StopATEAgent
  IfFileExists "$INSTDIR\stop-all-server.exe" use_current use_legacy
  use_current:
  ExecWait '"$INSTDIR\stop-all-server.exe" "$INSTDIR"'
  Goto done
  use_legacy:
  IfFileExists "$INSTDIR\stop-installed-server.exe" 0 done
  ExecWait '"$INSTDIR\stop-installed-server.exe" "$INSTDIR"'
  Sleep 500
  done:
FunctionEnd
