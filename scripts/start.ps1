[CmdletBinding()]
param([ValidateRange(1024, 65535)][int]$Port = 5080)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $repoRoot
try {
    Write-Host "Depart : http://localhost:$Port/"
    Write-Host "Reference : http://localhost:$Port/reference/"
    Write-Host 'Arret : Ctrl+C. Les packages NuGet doivent avoir ete restaures avant la seance.'
    & dotnet run --no-restore --project src/F1DataLab --urls "http://localhost:$Port"
    if ($LASTEXITCODE -ne 0) { throw "dotnet run a echoue ($LASTEXITCODE)." }
}
finally { Pop-Location }
