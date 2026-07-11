# One-command installer for the public GitHub repository.
# Usage: irm https://raw.githubusercontent.com/LucasGazula/dont-waste/main/scripts/install-remote.ps1 | iex
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Repository = if ($env:DONT_WASTE_REPOSITORY) { $env:DONT_WASTE_REPOSITORY } else { "LucasGazula/dont-waste" }
$Ref = if ($env:DONT_WASTE_REF) { $env:DONT_WASTE_REF } else { "main" }
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
$Prefix = if ($env:DONT_WASTE_PREFIX) { $env:DONT_WASTE_PREFIX } else { Join-Path $LocalAppData "dont-waste" }
$InstallRoot = if ($env:DONT_WASTE_INSTALL_ROOT) { $env:DONT_WASTE_INSTALL_ROOT } else { Join-Path $LocalAppData "dont-waste\installation" }
$Marker = Join-Path $InstallRoot ".dont-waste-remote-install"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dont-waste-remote-" + [guid]::NewGuid().ToString("N"))
$Archive = Join-Path $TempRoot "dont-waste.zip"

try {
  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
  $Url = "https://codeload.github.com/$Repository/zip/refs/heads/$Ref"
  Write-Host "Downloading Don’t Waste from $Url"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Archive
  Expand-Archive -LiteralPath $Archive -DestinationPath $TempRoot -Force
  $SourceRoot = Get-ChildItem -LiteralPath $TempRoot -Directory | Where-Object { $_.Name -ne "__MACOSX" } | Select-Object -First 1
  if (-not $SourceRoot) { throw "The downloaded Don’t Waste archive was empty." }

  $InstallParent = Split-Path -Parent $InstallRoot
  New-Item -ItemType Directory -Force -Path $InstallParent | Out-Null
  if (Test-Path -LiteralPath $InstallRoot) {
    if (-not (Test-Path -LiteralPath $Marker)) { throw "Refusing to replace an unrecognised directory: $InstallRoot" }
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  Move-Item -LiteralPath $SourceRoot.FullName -Destination $InstallRoot
  Set-Content -LiteralPath $Marker -Value "remote-install`nrepository=$Repository`nref=$Ref" -Encoding UTF8

  Write-Host "Preparing dependencies and opening the setup UI…"
  $LocalInstaller = Join-Path $InstallRoot "scripts\install.ps1"
  $PowerShell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
  & $PowerShell -ExecutionPolicy Bypass -File $LocalInstaller -Prefix $Prefix
  if ($LASTEXITCODE -ne 0) { throw "The local bootstrap failed with exit code $LASTEXITCODE." }

  $Shim = Join-Path $Prefix "bin\dont-waste.cmd"
  if (-not (Test-Path -LiteralPath $Shim)) { throw "The installer did not create $Shim" }
  Write-Host "`nInstallation complete. Launching Don’t Waste setup…"
  & $Shim
}
finally {
  if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
}
