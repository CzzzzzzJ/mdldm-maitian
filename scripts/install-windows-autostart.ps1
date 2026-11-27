param(
  [switch]$Uninstall,
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "MaitianDaemon-$userSid"
$taskPath = '\'

if ($Uninstall) {
  $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq $taskPath }
  if ($task) {
    if ($task.State -eq 'Running') { Stop-ScheduledTask -InputObject $task }
    Unregister-ScheduledTask -InputObject $task -Confirm:$false
  }
  Write-Host '已关闭 Windows 登录自启。'
  return
}

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root 'config.json') -PathType Leaf)) {
  throw '找不到 config.json，请先在麦田仓库目录运行 node src/init.mjs。'
}
if (-not $NodePath) { $NodePath = (Get-Command node.exe -CommandType Application).Source }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "找不到 Node.js 可执行文件：$NodePath"
}
$node = (Resolve-Path -LiteralPath $NodePath).ProviderPath

$action = New-ScheduledTaskAction -Execute $node -Argument 'src\hub.mjs daemon' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userSid
$principal = New-ScheduledTaskPrincipal -UserId $userSid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description '启动麦田发布中控' -Force | Out-Null
Write-Host "已启用 Windows 登录自启。下次登录 Windows 时启动麦田（计划任务：$taskName）。"
