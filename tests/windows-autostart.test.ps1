# PowerShell 5.1 / 7, no Pester required. Run from the repository root:
# powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\windows-autostart.test.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Assert($condition, $message) {
  if (-not $condition) { throw $message }
}

function Assert-Error($operation, $pattern) {
  try { & $operation }
  catch {
    Assert ($_.Exception.Message -like $pattern) "Unexpected error: $_"
    return
  }
  throw "Expected error matching $pattern"
}

# Mock the Windows boundary and keep the rest of the installer running as PowerShell.
$mock = @{ sid = 'S-1-5-21-100'; tasks = @{}; starts = 0; probes = 0; readyAfter = 0; stops = 0; removals = 0 }
function Get-ScheduledTask { $mock.tasks.Values }
function New-ScheduledTaskAction {
  param($Execute, $Argument, $WorkingDirectory)
  @{ execute = $Execute; argument = $Argument; directory = $WorkingDirectory }
}
function New-ScheduledTaskTrigger {
  param([switch]$AtLogOn, $User)
  @{ logon = $AtLogOn; user = $User }
}
function New-ScheduledTaskPrincipal {
  param($UserId, $LogonType, $RunLevel)
  @{ user = $UserId; logonType = $LogonType; runLevel = $RunLevel }
}
function New-ScheduledTaskSettingsSet {
  param($ExecutionTimeLimit, $MultipleInstances, [switch]$AllowStartIfOnBatteries,
    [switch]$DontStopIfGoingOnBatteries, $RestartCount, $RestartInterval)
  @{ timeLimit = $ExecutionTimeLimit; instances = $MultipleInstances; retries = $RestartCount; interval = $RestartInterval }
}
function Register-ScheduledTask {
  param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force)
  Assert $Force 'Reinstall must update the existing task'
  $mock.tasks[$TaskName] = [pscustomobject]@{
    TaskName = $TaskName; TaskPath = $TaskPath; Action = $Action; Trigger = $Trigger
    Principal = $Principal; Settings = $Settings; State = 'Ready'
  }
}
function Start-ScheduledTask {
  param($TaskName, $TaskPath)
  Assert ($TaskPath -eq '\' -and $mock.tasks.ContainsKey($TaskName)) 'The task must be registered before it is started'
  $mock.starts++
  if ($mock.startError) { throw 'simulated scheduler failure' }
}
function Stop-ScheduledTask {
  param($InputObject)
  Assert ($InputObject.State -eq 'Running') 'Only a running task needs to be stopped'
  $mock.stops++
}
function Unregister-ScheduledTask {
  param($InputObject, [switch]$Confirm)
  Assert (-not $Confirm) 'Uninstall must be noninteractive'
  $mock.tasks.Remove($InputObject.TaskName)
  $mock.removals++
}
function Start-Sleep { param($Milliseconds) }
function Get-MockTcpListener($port) {
  Assert ($port -eq 8789) 'Expected the configured dashboard port'
  $mock.probes++
  $mock.readyAfter -gt 0 -and $mock.probes -ge $mock.readyAfter
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('maitian autostart ' + [guid]::NewGuid())
try {
  $fixtureScripts = Join-Path $fixture 'scripts'
  [void][IO.Directory]::CreateDirectory($fixtureScripts)
  $config = Join-Path $fixture 'config.json'
  $installer = Join-Path $fixtureScripts 'install-windows-autostart.ps1'
  $fakeNode = Join-Path $fixture 'test node.exe'
  New-Item -ItemType File -Path $fakeNode | Out-Null

  $tokens = $null
  $errors = $null
  $source = Join-Path $root 'scripts/install-windows-autostart.ps1'
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
  Assert ($errors.Count -eq 0) ($errors -join [Environment]::NewLine)
  $probe = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-TcpListener' }, $true)
  $identity = '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
  Assert ($probe -and $ast.Extent.Text.Contains($identity)) 'Could not isolate the Windows APIs for testing'
  $fixtureSource = $ast.Extent.Text.Replace($identity, '$mock.sid').Replace($probe.Extent.Text, 'function Test-TcpListener($port) { Get-MockTcpListener $port }')
  [IO.File]::WriteAllText($installer, $fixtureSource, [Text.UTF8Encoding]::new($true))

  Assert-Error { & $installer -NodePath $fakeNode } '*config.json*'
  Set-Content -LiteralPath $config -Value '{"web":{"port":8789}}'
  Assert-Error { & $installer -NodePath (Join-Path $fixture 'missing.exe') } '*Node.js*'
  Assert ($mock.tasks.Count -eq 0) 'Invalid input registered a task'

  & $installer -NodePath $fakeNode
  $taskName = "MaitianDaemon-$($mock.sid)"
  $task = $mock.tasks[$taskName]
  Assert ($task.Action.directory -eq $fixture -and $task.Action.execute -eq $fakeNode) 'Incorrect task executable or working directory'
  Assert ($task.Action.argument -eq '--import ./scripts/windows/daemon-log.mjs src/hub.mjs daemon') 'The task should run Node directly and preload the daemon log'
  Assert ($task.Trigger.logon -and $task.Trigger.user -eq $mock.sid -and $task.Principal.user -eq $mock.sid -and $task.Principal.logonType -eq 'Interactive' -and $task.Principal.runLevel -eq 'Limited') 'Incorrect trigger or task identity'
  Assert ($task.Settings.retries -eq 3 -and $task.Settings.interval.TotalMinutes -eq 1 -and $task.Settings.instances -eq 'IgnoreNew' -and $task.Settings.timeLimit -eq [TimeSpan]::Zero) 'Unexpected task lifecycle settings'
  Assert ($mock.starts -eq 0) 'Installation without -StartNow should wait for login'

  $mock.readyAfter = 25
  $output = & $installer -NodePath $fakeNode -StartNow 3>&1 6>&1
  Assert ($mock.tasks.Count -eq 1 -and $mock.starts -eq 1 -and $mock.probes -eq 25 -and ($output -join ' ') -like '*8789*') 'Reinstall should start once and allow a slower dashboard to come up'
  $mock.readyAfter = 1
  & $installer -NodePath $fakeNode -StartNow
  Assert ($mock.starts -eq 1) 'A running dashboard should skip a duplicate start'

  $mock.readyAfter = 0
  $mock.probes = 0
  $output = & $installer -NodePath $fakeNode -StartNow 3>&1 6>&1
  Assert ($mock.starts -eq 2 -and $mock.probes -eq 61 -and ($output -join ' ') -like '*daemon.log*8789*daemon.log*') 'Timeout should be bounded and point to the daemon log'
  $mock.startError = $true
  $output = & $installer -NodePath $fakeNode -StartNow 3>&1 6>&1
  Assert ($mock.tasks.ContainsKey($taskName) -and ($output -join ' ') -like '*simulated scheduler failure*daemon.log*') 'A failed immediate start should keep the task and give a useful warning'

  $mock.tasks[$taskName].State = 'Running'
  & $installer -Uninstall
  & $installer -Uninstall
  Assert ($mock.tasks.Count -eq 0 -and $mock.stops -eq 1 -and $mock.removals -eq 1) 'Uninstall should stop and remove the task exactly once'
  Assert ((Get-Content -LiteralPath $config -Raw).Trim() -eq '{"web":{"port":8789}}') 'The existing config must stay intact'

  Write-Output 'Windows autostart tests passed.'
} finally {
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
