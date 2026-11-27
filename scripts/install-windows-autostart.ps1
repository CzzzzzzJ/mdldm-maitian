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
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
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
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 250
      if (Test-TcpListener $port) {
        Write-Host "大屏端口 $port 已开始监听。"
        return
      }
    }
    Write-Warning "等待期间未检测到端口 $port 监听。如果大屏打不开，请在任务计划程序中查看 $taskName 的状态。"
  }
} catch {
  Write-Warning "自启已注册，本次立即启动检查失败：$($_.Exception.Message)。请在任务计划程序中查看 $taskName 的状态。"
}
