# Bouwt de plugin en start de lokale Paper 1.21.11 server in run/.
# Gebruik:  .\start-server.ps1            (bouwen + starten)
#           .\start-server.ps1 -Reset     (run/ weggooien en opnieuw uit server-template/ halen)
#           .\start-server.ps1 -NoBuild   (alleen starten, plugin niet opnieuw bouwen)
#           .\start-server.ps1 -NoBlueMap (BlueMap 3D-kaart niet downloaden)
#           .\start-server.ps1 -Bots      (offline mode, alleen vanaf deze pc, zodat bots/ kan inloggen)
param(
    [switch]$Reset,
    [switch]$NoBuild,
    [switch]$NoBlueMap,
    [switch]$Bots,
    [string]$Memory = "2G"
)

# BlueMap 5.16 is de laatste versie die Minecraft 1.21.11 ondersteunt
$blueMapJar    = "bluemap-5.16-paper.jar"
$blueMapUrl    = "https://cdn.modrinth.com/data/swbUV1cr/versions/Vb2ZE8bR/bluemap-5.16-paper.jar"
$blueMapSha512 = "4336174ede66d4c2f14d1830c068b7a8229afd0dd5e736526246486c1e3ff28eeed6c8044e74ddc81b5067a055a153189006389f5d3e70f434138fe7753628f2"

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

# 3b. Botmodus. Bots hebben geen Minecraft-account, dus de server moet in offline mode.
#     Offline mode betekent dat iedereen met elke naam kan inloggen (ook met die van een op),
#     daarom luistert de server dan alleen op 127.0.0.1. Zonder -Bots wordt dat teruggezet.
function Set-ServerProperty([string]$file, [string]$key, [string]$value) {
    $lines = @(Get-Content $file)
    $found = $false
    $lines = $lines | ForEach-Object {
        if ($_ -match "^$([regex]::Escape($key))=") { $found = $true; "$key=$value" } else { $_ }
    }
    if (-not $found) { $lines += "$key=$value" }
    [IO.File]::WriteAllLines($file, [string[]]$lines)
}
$props = Join-Path $run "server.properties"
$botMarker = Join-Path $run ".bots-mode"
if ($Bots) {
    Set-ServerProperty $props "online-mode" "false"
    Set-ServerProperty $props "enforce-secure-profile" "false"
    Set-ServerProperty $props "server-ip" "127.0.0.1"
    New-Item -ItemType File -Force $botMarker | Out-Null
    Write-Host "Botmodus: offline mode, alleen bereikbaar vanaf deze pc. Start de bots in een tweede venster met .\start-bots.ps1"
} elseif (Test-Path $botMarker) {
    Set-ServerProperty $props "online-mode" "true"
    Set-ServerProperty $props "enforce-secure-profile" "true"
    Set-ServerProperty $props "server-ip" ""
    Remove-Item -Force $botMarker
    Write-Host "Botmodus uit: server staat weer in online mode."
}

# 4. Nieuwste plugin-jar in de server zetten
$jar = Join-Path $pluginDir "target\SlopSlurperPlugin.jar"
if (Test-Path $jar) {
    New-Item -ItemType Directory -Force (Join-Path $run "plugins") | Out-Null
    Copy-Item -Force $jar (Join-Path $run "plugins\SlopSlurperPlugin.jar")
} else {
    Write-Warning "Geen plugin-jar gevonden in plugin\target. Server start zonder plugin."
}

# 4b. BlueMap (3D-kaart) eenmalig downloaden, met checksum-controle.
#     Mislukt de download, dan start de server gewoon zonder BlueMap.
if (-not $NoBlueMap) {
    $blueMapPath = Join-Path $run "plugins\$blueMapJar"
    if (-not (Test-Path $blueMapPath)) {
        Write-Host "BlueMap downloaden (eenmalig, ~6 MB)..."
        $tmp = "$blueMapPath.download"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $blueMapUrl -OutFile $tmp -UseBasicParsing
            $hash = (Get-FileHash $tmp -Algorithm SHA512).Hash.ToLower()
            if ($hash -ne $blueMapSha512) { throw "checksum klopt niet" }
            Move-Item -Force $tmp $blueMapPath
            Write-Host "BlueMap geinstalleerd."
        } catch {
            Remove-Item -Force $tmp -ErrorAction SilentlyContinue
            Write-Warning "BlueMap downloaden mislukt ($($_.Exception.Message)). Server start zonder 3D-kaart."
        }
    }
    $coreConf = Join-Path $run "plugins\BlueMap\core.conf"
    if ((Test-Path $coreConf) -and (Select-String -Path $coreConf -Pattern '^accept-download:\s*false' -Quiet)) {
        Write-Warning "BlueMap wacht op jouw akkoord: zet 'accept-download: true' in run\plugins\BlueMap\core.conf (zie README)."
    }
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
