; Install AudioDeviceCmdlets PowerShell module during app install (CurrentUser = no admin required)
!macro customInstall
  SetOutPath $TEMP
  FileOpen $0 "$TEMP\install-audiodevice.ps1" w
  FileWrite $0 "if (!(Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) { Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null }; if (!(Get-Module -ListAvailable -Name AudioDeviceCmdlets)) { Install-Module -Name AudioDeviceCmdlets -Force -Scope CurrentUser }"
  FileClose $0
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$TEMP\install-audiodevice.ps1"'
  Delete "$TEMP\install-audiodevice.ps1"
!macroend
