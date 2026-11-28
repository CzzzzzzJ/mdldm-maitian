# 麦田 · Windows 登录自启
# 给当前 Windows 用户注册计划任务，登录后运行麦田，日志追加到 data\daemon.log。
# 在仓库根目录运行 powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-autostart.ps1
#   不加参数    注册登录自启
#   -StartNow   注册后立即启动，并检查大屏端口
#   -Uninstall  停止并移除自启任务
# 安装向导通过 -NodePath 传入当前 Node.js 路径，手动运行时默认从 PATH 查找 node.exe。
# 如果更换 Node.js 后可执行文件路径变化，请重新运行本脚本更新计划任务。

param(
  [switch]$Uninstall,
  [switch]$StartNow,
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
$configPath = Join-Path $root 'config.json'
$logPath = Join-Path $root 'data\daemon.log'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw '找不到 config.json，请先在麦田仓库目录运行 node src/init.mjs。'
}
if (-not $NodePath) { $NodePath = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "找不到 Node.js 可执行文件：$NodePath"
}
$node = (Resolve-Path -LiteralPath $NodePath).ProviderPath

$arguments = '--import ./scripts/windows/daemon-log.mjs src/hub.mjs daemon'
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userSid
$principal = New-ScheduledTaskPrincipal -UserId $userSid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description '启动麦田发布中控' -Force | Out-Null
Write-Host "已启用 Windows 登录自启。下次登录 Windows 时启动麦田（计划任务：$taskName）。"
Write-Host "运行日志 $logPath"

if (-not $StartNow) { return }

function Test-TcpListener([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync([System.Net.IPAddress]::Loopback, $Port)
    return ($connection.Wait(150) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

try {
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $port = [int]$config.web.port
  if ($port -gt 0 -and (Test-TcpListener $port)) {
    Write-Host "端口 $port 已有进程监听，跳过本次启动。"
    return
  }
  Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  Write-Host '已请求立即启动麦田。'
  if ($port -gt 0) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      Start-Sleep -Milliseconds 250
      if (Test-TcpListener $port) {
        Write-Host "大屏端口 $port 已开始监听。"
        return
      }
    }
    Write-Warning "等待期间未检测到端口 $port 监听。请查看运行日志 $logPath 和计划任务 $taskName 的状态。"
  }
} catch {
  Write-Warning "自启已注册，本次立即启动检查失败：$($_.Exception.Message)。请查看运行日志 $logPath 和计划任务 $taskName 的状态。"
}
