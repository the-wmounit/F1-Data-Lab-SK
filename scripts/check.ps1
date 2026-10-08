[CmdletBinding()]
param([switch]$IncludeNode)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $repoRoot
try {
    & dotnet build src/F1DataLab --no-restore
    if ($LASTEXITCODE -ne 0) { throw "Build .NET en echec ($LASTEXITCODE)." }
    & dotnet run --no-restore --project tests/F1DataLab.SelfTest
    if ($LASTEXITCODE -ne 0) { throw "Self-tests .NET en echec ($LASTEXITCODE)." }
    if ($IncludeNode) {
        & node --test scripts/ingest.test.mjs
        if ($LASTEXITCODE -ne 0) { throw "Tests ingestion en echec ($LASTEXITCODE)." }
        if (Test-Path -LiteralPath frontend/package.json) {
            & npm.cmd test --prefix frontend
            if ($LASTEXITCODE -ne 0) { throw "Tests frontend en echec ($LASTEXITCODE)." }
            & npm.cmd run build --prefix frontend
            if ($LASTEXITCODE -ne 0) { throw "Build frontend en echec ($LASTEXITCODE)." }
        }
    }
    Write-Host 'Verifications executees avec succes. Le rendu reste a verifier dans le navigateur.'
}
finally { Pop-Location }
