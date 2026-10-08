[CmdletBinding()]
param([switch]$Create)

# Dry run by default. -Create makes local snapshot commits and lightweight tags
# with an isolated index; HEAD, the real index and working files are untouched.
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowedPaths = @(
    'README.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore', '.gitattributes',
    'global.json', 'F1DataLab.sln', 'F1DataLab.slnx', 'LICENSE',
    'src', 'tests', 'scripts', 'docs', 'data', 'frontend', 'wwwroot', 'vendor'
)

function Invoke-WorkshopGit {
    param([string[]]$Arguments)
    $lines = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') a echoue ($LASTEXITCODE)." }
    return $lines
}

function Test-AllowedWorkshopPath {
    param([string]$Path)
    foreach ($allowed in $allowedPaths) {
        if ($Path -eq $allowed -or $Path.StartsWith("$allowed/", [System.StringComparison]::Ordinal)) { return $true }
    }
    return $false
}

Push-Location -LiteralPath $repoRoot
$previousIndex = $env:GIT_INDEX_FILE
$temporaryIndex = $null
try {
    $actualRoot = [System.IO.Path]::GetFullPath((Invoke-WorkshopGit -Arguments @('rev-parse', '--show-toplevel')))
    if ($actualRoot -ne $repoRoot) { throw 'Le script doit appartenir a la racine de ce depot Git.' }
    $parentCommit = Invoke-WorkshopGit -Arguments @('rev-parse', '--verify', 'HEAD')
    foreach ($tag in @('workshop-start', 'demo-fallback')) {
        $existing = & git show-ref --verify --quiet "refs/tags/$tag"
        if ($LASTEXITCODE -eq 0) { throw "Le tag $tag existe deja. Aucune reecriture automatique." }
        if ($LASTEXITCODE -ne 1) { throw "Verification du tag $tag impossible." }
    }
    $tracked = @(Invoke-WorkshopGit -Arguments @('ls-files', '--cached'))
    $outside = @($tracked | Where-Object { -not (Test-AllowedWorkshopPath $_) })
    if ($outside.Count -gt 0) {
        throw "Fichiers suivis hors perimetre : $($outside -join ', '). Relire et adapter la liste explicite avant creation."
    }
    $files = @(Invoke-WorkshopGit -Arguments (@('ls-files', '--cached', '--others', '--exclude-standard', '--') + $allowedPaths)) |
        Where-Object { Test-Path -LiteralPath (Join-Path $repoRoot $_) -PathType Leaf } |
        Sort-Object -Unique
    $forbidden = @($files | Where-Object { $_ -match '(^|/)(bin|obj|node_modules|raw|\.cache|artifacts)(/|$)|\.sqlite($|-)' })
    if ($forbidden.Count -gt 0) { throw "Sorties generees presentes dans la selection : $($forbidden -join ', '). Les exclure de Git." }
    $required = @(
        'src/F1DataLab/Program.cs', 'tests/F1DataLab.SelfTest/Program.cs',
        'data/catalog.json', 'data/championship-2024.json',
        'data/2024/1/replay.json', 'data/2024/2/replay.json',
        'wwwroot/index.html', 'wwwroot/reference/index.html', 'docs/data-contract.md',
        'wwwroot/vendor/three/three.module.js', 'wwwroot/vendor/three/three.core.js',
        'wwwroot/vendor/three/OrbitControls.js',
        'wwwroot/vendor/three/addons/loaders/GLTFLoader.js',
        'wwwroot/vendor/three/addons/utils/BufferGeometryUtils.js',
        'wwwroot/models/f1-2026.glb', 'wwwroot/models/manifest.json',
        'wwwroot/models/README.md'
    )
    foreach ($requiredFile in $required) {
        if ($files -notcontains $requiredFile) { throw "Snapshot incomplet : $requiredFile est absent de la selection." }
    }
    $referenceFiles = @($files | Where-Object { $_.StartsWith('frontend/') -or $_.StartsWith('wwwroot/reference/') })
    Write-Host "Snapshot complet : $($files.Count) fichiers selectionnes depuis le dossier courant."
    Write-Host "Starter : meme snapshot sans les $($referenceFiles.Count) fichiers frontend/ et wwwroot/reference/."
    Write-Host 'Les fichiers existants non selectionnes et l index Git reel restent intacts.'
    $files | ForEach-Object { Write-Host "  $_" }
    Invoke-WorkshopGit -Arguments @('diff', '--stat') | ForEach-Object { Write-Host $_ }
    if (-not $Create) {
        Write-Host 'Aucune mutation. Relire git diff et verifier les deux interfaces avant -Create.'
        return
    }

    # Ensure configured identities are available before creating any commit object.
    $null = Invoke-WorkshopGit -Arguments @('var', 'GIT_AUTHOR_IDENT')
    $null = Invoke-WorkshopGit -Arguments @('var', 'GIT_COMMITTER_IDENT')
    $temporaryDirectory = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.cache'))
    $null = [System.IO.Directory]::CreateDirectory($temporaryDirectory)
    $temporaryIndex = [System.IO.Path]::GetFullPath((Join-Path $temporaryDirectory ("workshop-index-" + [guid]::NewGuid().ToString('N'))))
    if (-not $temporaryIndex.StartsWith($temporaryDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Index temporaire hors du dossier autorise.'
    }
    $env:GIT_INDEX_FILE = $temporaryIndex
    $null = Invoke-WorkshopGit -Arguments @('read-tree', '--empty')
    $null = Invoke-WorkshopGit -Arguments (@('-c', 'core.autocrlf=false', 'add', '--') + $files)
    $fallbackTree = Invoke-WorkshopGit -Arguments @('write-tree')
    $fallbackCommit = Invoke-WorkshopGit -Arguments @('commit-tree', $fallbackTree, '-p', $parentCommit, '-m', 'feat(workshop): snapshot final reference')
    $null = Invoke-WorkshopGit -Arguments (@('update-index', '--force-remove', '--') + $referenceFiles)
    $starterTree = Invoke-WorkshopGit -Arguments @('write-tree')
    if ($starterTree -eq $fallbackTree) { throw 'Les arbres starter et reference doivent etre distincts.' }
    $starterCommit = Invoke-WorkshopGit -Arguments @('commit-tree', $starterTree, '-p', $parentCommit, '-m', 'feat(workshop): snapshot starter without reference implementation')

    # Atomic creation refuses to overwrite either existing tag, including a race
    # where a different process created a tag since the preflight above.
    $refCommands = @(
        'start', "create refs/tags/workshop-start $starterCommit",
        "create refs/tags/demo-fallback $fallbackCommit", 'prepare', 'commit'
    ) -join "`n"
    $refCommands | & git update-ref --stdin
    if ($LASTEXITCODE -ne 0) { throw 'Creation atomique des tags en echec. Aucun reset ni checkout effectue.' }
    Write-Host "workshop-start : $starterCommit (arbre $starterTree)"
    Write-Host "demo-fallback : $fallbackCommit (arbre $fallbackTree)"
    Write-Host 'Tags locaux crees ; HEAD et index reel inchanges. Aucun push.'
}
finally {
    if ($null -eq $previousIndex) { Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue }
    else { $env:GIT_INDEX_FILE = $previousIndex }
    if ($temporaryIndex) {
        # Nonrecursive deletion of exactly the isolated index and its lock.
        foreach ($temporaryFile in @($temporaryIndex, "$temporaryIndex.lock")) {
            if (Test-Path -LiteralPath $temporaryFile -PathType Leaf) { Remove-Item -LiteralPath $temporaryFile }
        }
    }
    Pop-Location
}
