# Bouwt de plugin en start de lokale Paper 1.21.11 server in run/.
# Gebruik:  .\start-server.ps1            (bouwen + starten)
#           .\start-server.ps1 -Reset     (run/ weggooien en opnieuw uit server-template/ halen)
#           .\start-server.ps1 -NoBuild   (alleen starten, plugin niet opnieuw bouwen)
param(
    [switch]$Reset,
    [switch]$NoBuild,
    [string]$Memory = "2G"
)

$ErrorActionPreference = "Stop"
$root     = $PSScriptRoot
$template = Join-Path $root "server-template"
$run      = Join-Path $root "run"
$pluginDir = Join-Path $root "plugin"
# Markeert het java-proces, zodat dit script een server uit deze map later terugvindt
$marker   = "-Dslopslurper.run=$run"

function Get-RunningServers {
    Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) }
}

function Get-ServerPort {
    foreach ($f in @((Join-Path $run "server.properties"), (Join-Path $template "server.properties"))) {
        if (Test-Path $f) {
            $m = Select-String -Path $f -Pattern '^server-port=(\d+)' | Select-Object -First 1
            if ($m) { return [int]$m.Matches[0].Groups[1].Value }
            break
        }
    }
    return 25565
}

function Test-PortInUse([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if ($async.AsyncWaitHandle.WaitOne(1000)) { $client.EndConnect($async); return $true }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# 0. Een server van een vorige start die nog draait (nog aan het afsluiten, of open in een
#    ander venster) houdt de poort bezet. Die eerst stoppen, vóór -Reset run/ weggooit.
$old = @(Get-RunningServers)
if ($old.Count -gt 0) {
    foreach ($p in $old) {
        Write-Host "Er draait nog een server van een vorige start (PID $($p.ProcessId)). Wachten tot die afgesloten is..."
    }
    $ids = $old | ForEach-Object { $_.ProcessId }
    Wait-Process -Id $ids -Timeout 30 -ErrorAction SilentlyContinue
    foreach ($id in $ids) {
        if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
            Write-Warning "Server (PID $id) is na 30s nog niet gestopt en wordt geforceerd afgesloten."
            Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
            Wait-Process -Id $id -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
}
$port = Get-ServerPort
if (Test-PortInUse $port) {
    Write-Error "Poort $port is al in gebruik door een ander programma, de server kan niet starten. Zoek het met 'Get-NetTCPConnection -LocalPort $port' en stop het, of zet een andere server-port in run\server.properties."
}

function Get-JavaMajor([string]$javaExe) {
    # java -version schrijft naar stderr; in PowerShell 5.1 mag dat niet als fout tellen
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & $javaExe -version 2>&1 | Out-String
    $ErrorActionPreference = $prev
    if ($out -match 'version "(\d+)(\.(\d+))?') {
        $major = [int]$Matches[1]
        if ($major -eq 1) { $major = [int]$Matches[3] }
        return $major
    }
    return 0
}

# 1. Java 21+ zoeken: eerst JAVA_HOME, dan java op PATH, dan bekende installatiemappen
$candidates = @()
if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME "bin\java.exe") }
$onPath = Get-Command java -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
foreach ($dir in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Zulu")) {
    if (Test-Path $dir) {
        Get-ChildItem $dir -Directory | Sort-Object Name -Descending | ForEach-Object {
            $candidates += (Join-Path $_.FullName "bin\java.exe")
        }
    }
}

$java = $null
foreach ($c in $candidates) {
    if ((Test-Path $c) -and ((Get-JavaMajor $c) -ge 21)) { $java = $c; break }
}
if (-not $java) {
    Write-Error "Geen Java 21 of nieuwer gevonden. Installeer bijvoorbeeld Temurin 21: https://adoptium.net/"
}
$env:JAVA_HOME = Split-Path (Split-Path $java -Parent) -Parent
Write-Host "Java: $java"

# 2. Plugin bouwen
if (-not $NoBuild) {
    Write-Host "Plugin bouwen..."
    Push-Location $pluginDir
    try {
        & .\mvnw.cmd -q -B package
        if ($LASTEXITCODE -ne 0) { throw "Plugin build mislukt." }
    } finally { Pop-Location }
}

# 3. run/ klaarzetten vanuit de template
if ($Reset -and (Test-Path $run)) {
    Write-Host "run/ wordt gereset vanuit server-template/..."
    Remove-Item -Recurse -Force $run
}
if (-not (Test-Path $run)) {
    Write-Host "run/ aanmaken vanuit server-template/..."
    Copy-Item -Recurse $template $run
}

# 4. Nieuwste plugin-jar in de server zetten
$jar = Join-Path $pluginDir "target\SlopSlurperPlugin.jar"
if (Test-Path $jar) {
    New-Item -ItemType Directory -Force (Join-Path $run "plugins") | Out-Null
    Copy-Item -Force $jar (Join-Path $run "plugins\SlopSlurperPlugin.jar")
} else {
    Write-Warning "Geen plugin-jar gevonden in plugin\target. Server start zonder plugin."
}

# 5. Server starten. De korte tmp-map voorkomt een bekende Windows-fout
#    ("Unable to establish loopback connection") bij sommige TEMP-paden.
$sockTmp = Join-Path $env:USERPROFILE ".mc-tmp"
New-Item -ItemType Directory -Force $sockTmp | Out-Null

Push-Location $run
try {
    & $java $marker "-Djdk.net.unixdomain.tmpdir=$sockTmp" "-Xms1G" "-Xmx$Memory" -jar paper.jar --nogui
} finally {
    # Na Ctrl+C geeft PowerShell de prompt meteen terug terwijl Java nog aan het afsluiten is
    # (wereld opslaan, poort vrijgeven). Wachten tot de server echt weg is.
    $still = @(Get-RunningServers)
    if ($still.Count -gt 0) {
        Write-Host "Server wordt afgesloten, even wachten..."
        Wait-Process -Id ($still | ForEach-Object { $_.ProcessId }) -ErrorAction SilentlyContinue
    }
    Pop-Location
}
