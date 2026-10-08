param([string]$BaseUrl = 'http://localhost:5080')
$ErrorActionPreference = 'Stop'

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) { throw "$Message : attendu=$Expected obtenu=$Actual" }
}
function Get-Response([string]$Path, [hashtable]$Headers = @{}) {
    Invoke-WebRequest -Uri "$BaseUrl$Path" -Headers $Headers -SkipHttpErrorCheck
}

Assert-Equal 200 (Invoke-WebRequest -Uri "$BaseUrl/" -Method Head -SkipHttpErrorCheck).StatusCode 'Page de départ'
$reference = Get-Response '/reference/'
Assert-Equal 200 $reference.StatusCode 'Page de référence'
$bundlePaths = [regex]::Matches($reference.Content, '(?:src|href)="(/reference/assets/[^\"]+\.(?:js|css))"')
if ($bundlePaths.Count -lt 2) { throw 'Bundles JS/CSS locaux absents du HTML de référence' }
foreach ($bundlePath in $bundlePaths) {
    Assert-Equal 200 (Invoke-WebRequest -Uri "$BaseUrl$($bundlePath.Groups[1].Value)" -Method Head -SkipHttpErrorCheck).StatusCode 'Bundle local'
}
$model = Invoke-WebRequest -Uri "$BaseUrl/models/f1-2026.glb" -Method Head -SkipHttpErrorCheck
Assert-Equal 200 $model.StatusCode 'Modèle F1 GLB local'
Assert-Equal 'model/gltf-binary' $model.Headers.'Content-Type'[0] 'Type MIME GLB'
if ([long]$model.Headers.'Content-Length'[0] -lt 100000) { throw 'Modèle F1 GLB absent ou tronqué' }

$health = Get-Response '/api/health'
Assert-Equal 200 $health.StatusCode 'Health'
Assert-Equal 'offline' ($health.Content | ConvertFrom-Json).mode 'Runtime hors ligne'

$catalogResponse = Get-Response '/api/races'
Assert-Equal 200 $catalogResponse.StatusCode 'Catalogue'
$catalog = $catalogResponse.Content | ConvertFrom-Json
Assert-Equal 2 $catalog.races.Count 'Deux replays locaux'
Assert-Equal 304 (Get-Response '/api/races' @{ 'If-None-Match' = $catalogResponse.Headers.ETag[0] }).StatusCode 'ETag catalogue'

foreach ($race in $catalog.races) {
    $prefix = "/$($race.year)/$($race.round)"
    foreach ($kind in @('results', 'laps', 'pits', 'replay', 'quality')) {
        $response = Get-Response "/api/$kind$prefix"
        Assert-Equal 200 $response.StatusCode "$kind $prefix"
        $payload = $response.Content | ConvertFrom-Json -Depth 100
        Assert-Equal $race.year $payload.year "$kind year"
        Assert-Equal $race.round $payload.round "$kind round"
        if ($kind -eq 'replay') {
            Assert-Equal 1 $payload.sampleHz 'Fréquence de replay'
            Assert-Equal 20 $payload.drivers.Count 'Pilotes du replay'
            if ($payload.circuit.points.Count -lt 100) { throw 'Tour circuit incomplet' }
        }
    }
}

$modern = (Get-Response '/api/championship/2024?scoring=2024').Content | ConvertFrom-Json -Depth 100
Assert-Equal 24 $modern.frames.Count '24 manches championnat'
Assert-Equal 437 ($modern.frames[-1].standings | Where-Object driverId -eq 'max_verstappen').points 'Total champion 2024'
Assert-Equal 374 ($modern.frames[-1].standings | Where-Object driverId -eq 'norris').points 'Total Norris 2024'
$legacy = (Get-Response '/api/championship/2024?scoring=2010').Content | ConvertFrom-Json -Depth 100
Assert-Equal '2010' $legacy.scoring 'Barème 2010'
$custom = Get-Response '/api/championship/2024?scoring=custom&points=10,8,6,4,2'
Assert-Equal 200 $custom.StatusCode 'Barème personnalisé'
foreach ($query in @('scoring=unknown', 'scoring=custom', 'scoring=custom&points=1,2', 'scoring=custom&points=-1', 'scoring=custom&points=NaN')) {
    Assert-Equal 400 (Get-Response "/api/championship/2024?$query").StatusCode "Barème refusé $query"
}
Assert-Equal 404 (Get-Response '/api/replay/1999/1').StatusCode 'Course absente'
Assert-Equal 404 (Get-Response '/api/championship/1999').StatusCode 'Saison absente'
Write-Output 'PASS : pages et bundles locaux, catalogue, ETag 304, dix endpoints de courses, classement et erreurs 400/404.'
