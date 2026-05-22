param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$ServerUrl = 'ws://127.0.0.1:38991/ws',
  [switch]$OverwriteSettings
)

$ErrorActionPreference = 'Stop'

$extensionPath = Join-Path $RepoRoot 'vscode-extension'
if (-not (Test-Path (Join-Path $extensionPath 'package.json'))) {
  throw "VS Code extension package.json was not found at $extensionPath"
}

$code = Get-Command code -ErrorAction Stop
$instances = @(
  @{ Name = 'Alice'; UserDataDir = Join-Path $env:TEMP 'lan-chat-a' },
  @{ Name = 'Bob'; UserDataDir = Join-Path $env:TEMP 'lan-chat-b' }
)

foreach ($instance in $instances) {
  New-Item -ItemType Directory -Force -Path $instance.UserDataDir | Out-Null
  $settingsDir = Join-Path $instance.UserDataDir 'User'
  New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
  $settingsPath = Join-Path $settingsDir 'settings.json'
  $settings = @{}
  if ((Test-Path -LiteralPath $settingsPath) -and -not $OverwriteSettings) {
    try {
      $existing = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json -AsHashtable
      if ($existing) {
        $settings = $existing
      }
    } catch {
      Write-Warning "Could not parse existing settings at $settingsPath. Recreating it."
    }
  }

  if ($OverwriteSettings -or -not $settings.ContainsKey('lanTextChat.username')) {
    $settings['lanTextChat.username'] = $instance.Name
  }
  if ($OverwriteSettings -or -not $settings.ContainsKey('lanTextChat.serverUrl')) {
    $settings['lanTextChat.serverUrl'] = $ServerUrl
  }
  if ($OverwriteSettings -or -not $settings.ContainsKey('lanTextChat.offlineMode')) {
    $settings['lanTextChat.offlineMode'] = $false
  }
  if ($OverwriteSettings -or -not $settings.ContainsKey('lanTextChat.enableReadReceipts')) {
    $settings['lanTextChat.enableReadReceipts'] = $true
  }
  if ($OverwriteSettings -or -not $settings.ContainsKey('lanTextChat.autoReconnect')) {
    $settings['lanTextChat.autoReconnect'] = $true
  }

  $settings | ConvertTo-Json | Set-Content -Path $settingsPath -Encoding UTF8

  & $code.Source `
    --new-window `
    --extensionDevelopmentPath $extensionPath `
    --user-data-dir $instance.UserDataDir `
    --command workbench.view.extension.lanTextChat `
    $extensionPath
}

Write-Host "Started two VS Code extension development windows."
Write-Host "Extension: $extensionPath"
Write-Host "Alice and Bob user-data settings are ready. Existing serverUrl values are preserved unless -OverwriteSettings is used."
