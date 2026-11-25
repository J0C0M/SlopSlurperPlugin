# Start testbots die op de lokale server spelen, zodat de trackers data verzamelen.
# Start eerst de server met:  .\start-server.ps1 -Bots
# Gebruik:  .\start-bots.ps1              (4 bots)
#           .\start-bots.ps1 -Count 5     (ander aantal; zie README)
#           .\start-bots.ps1 -Pvp         (bots vallen elkaar soms aan, nooit echte spelers)
#           .\start-bots.ps1 -Schedule    (bots spelen alleen op hun eigen speeltijden)
#           .\start-bots.ps1 -Homes       (experimenteel: bots bouwen een eigen huis)
# Overige opties gaan door naar bots.js, bijvoorbeeld: .\start-bots.ps1 --session-min 5 --session-max 15
param(
    [int]$Count = 4,
    [switch]$Pvp,
    [switch]$Schedule,
    [switch]$Homes,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = "Stop"
$botsDir = Join-Path $PSScriptRoot "bots"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js niet gevonden. Installeer Node 22 of nieuwer: https://nodejs.org/"
}
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
    Write-Error "Node $major gevonden, maar de bots hebben Node 22 of nieuwer nodig: https://nodejs.org/"
}

Push-Location $botsDir
try {
    # Afhankelijkheden (opnieuw) installeren als ze ontbreken of package-lock.json nieuwer is
    $installed = Join-Path $botsDir "node_modules\.package-lock.json"
    $lock = Join-Path $botsDir "package-lock.json"
    if (-not (Test-Path $installed) -or ((Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)) {
        Write-Host "Bot-afhankelijkheden installeren..."
        & npm ci --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw "npm ci mislukt." }
    }

    $botArgs = @("bots.js", "--count", $Count)
    if ($Pvp) { $botArgs += "--pvp" }
    if ($Schedule) { $botArgs += "--schedule" }
    if ($Homes) { $botArgs += "--homes" }
    if ($Rest) { $botArgs += $Rest }
    & node @botArgs
} finally {
    Pop-Location
}
