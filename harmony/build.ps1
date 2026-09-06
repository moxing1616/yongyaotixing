param([string]$DevEcoHome = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$candidateRoots = @($DevEcoHome, $env:DEVECO_HOME,
  'C:\Program Files\Huawei\DevEco Studio', 'D:\Program Files\Huawei\DevEco Studio',
  'C:\Program Files\DevEco Studio', 'D:\Program Files\DevEco Studio')
$studioRoot = $candidateRoots | Where-Object {
  $_ -and (Test-Path -LiteralPath (Join-Path $_ 'tools\hvigor\bin\hvigorw.bat'))
} | Select-Object -First 1
if (-not $studioRoot) {
  throw '未找到 DevEco Studio。请从华为官方下载并安装，然后运行 .\build.ps1 -DevEcoHome "安装目录"。尚未执行 HAP 构建。'
}
$ohpmTool = Join-Path $studioRoot 'tools\ohpm\bin\ohpm.bat'
$hvigorTool = Join-Path $studioRoot 'tools\hvigor\bin\hvigorw.bat'
$nodeDirectory = Join-Path $studioRoot 'tools\node'
$jdkDirectory = Join-Path $studioRoot 'jbr'
foreach ($toolPath in @($ohpmTool, $hvigorTool, (Join-Path $nodeDirectory 'node.exe'), (Join-Path $jdkDirectory 'bin\java.exe'))) {
  if (-not (Test-Path -LiteralPath $toolPath)) { throw "工具不存在：$toolPath。请完成 DevEco Studio 安装。" }
}
# These environment changes affect this PowerShell process only.
$env:JAVA_HOME = $jdkDirectory
$env:DEVECO_SDK_HOME = Join-Path $studioRoot 'sdk'
$env:Path = "$nodeDirectory;$(Join-Path $jdkDirectory 'bin');$env:Path"
& $ohpmTool install
if ($LASTEXITCODE -ne 0) { throw 'ohpm install 失败，尚未执行 HAP 构建。' }
& $hvigorTool --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
if ($LASTEXITCODE -ne 0) { throw 'HAP 构建失败，请查看上方完整错误。' }
$artifacts = Get-ChildItem -LiteralPath 'entry\build\default\outputs\default' -Filter '*.hap' -ErrorAction SilentlyContinue
if (-not $artifacts) { throw '构建命令结束但没有找到 HAP 产物，不能视为构建成功。' }
$artifacts | Select-Object FullName, Length
