# Version Bump PowerShell Script
# 
# Usage:
#   .\scripts\version-bump.ps1 patch       # Bump patch version (1.0.0 -> 1.0.1)
#   .\scripts\version-bump.ps1 minor       # Bump minor version (1.0.0 -> 1.1.0)
#   .\scripts\version-bump.ps1 major       # Bump major version (1.0.0 -> 2.0.0)
#   .\scripts\version-bump.ps1 1.2.3       # Set specific version
#   .\scripts\version-bump.ps1 current     # Show current version

param(
    [Parameter(Mandatory=$true)]
    [string]$Command,
    
    [switch]$NoTag,
    [switch]$NoCommit
)

$ErrorActionPreference = "Stop"

# Path to manifest.json
$ManifestPath = Join-Path $PSScriptRoot "..\src\manifest.json"

# Color functions
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Blue }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

# Get current version from manifest.json
function Get-CurrentVersion {
    try {
        $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
        return $manifest.version
    }
    catch {
        Write-Error "Error reading manifest.json: $_"
        exit 1
    }
}

# Update version in manifest.json
function Update-Version {
    param([string]$NewVersion)
    
    try {
        $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
        $oldVersion = $manifest.version
        $manifest.version = $NewVersion
        
        # Save with proper formatting
        $json = $manifest | ConvertTo-Json -Depth 10
        Set-Content -Path $ManifestPath -Value $json -Encoding UTF8
        
        return $oldVersion
    }
    catch {
        Write-Error "Error updating manifest.json: $_"
        exit 1
    }
}

# Validate version format
function Test-ValidVersion {
    param([string]$Version)
    return $Version -match '^\d+\.\d+\.\d+$'
}

# Calculate new version based on bump type
function Get-NewVersion {
    param(
        [string]$CurrentVersion,
        [string]$BumpType
    )
    
    $parts = $CurrentVersion.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    
    switch ($BumpType) {
        'major' { return "$($major + 1).0.0" }
        'minor' { return "$major.$($minor + 1).0" }
        'patch' { return "$major.$minor.$($patch + 1)" }
        default {
            if (Test-ValidVersion $BumpType) {
                return $BumpType
            }
            throw "Invalid bump type or version: $BumpType"
        }
    }
}

# Create git commit and tag
function New-GitCommitAndTag {
    param(
        [string]$Version,
        [bool]$CreateTag = $true
    )
    
    try {
        Write-Info "`nCreating git commit..."
        git add src/manifest.json
        git commit -m "chore: bump version to $Version"
        
        if ($CreateTag) {
            Write-Info "`nCreating git tag v$Version..."
            git tag "v$Version"
            
            Write-Success "`n✓ Version bumped to $Version"
            Write-Host "`nTo push changes and trigger release:"
            Write-Warning "  git push origin main"
            Write-Warning "  git push origin v$Version"
        }
        else {
            Write-Success "`n✓ Version bumped to $Version (no tag created)"
            Write-Host "`nTo push changes:"
            Write-Warning "  git push origin main"
        }
    }
    catch {
        Write-Error "Error creating git commit: $_"
        Write-Host "`nYou can manually commit with:"
        Write-Warning "  git add src/manifest.json"
        Write-Warning "  git commit -m `"chore: bump version to $Version`""
        Write-Warning "  git tag v$Version"
    }
}

# Main script
$currentVersion = Get-CurrentVersion

if ($Command -eq 'current') {
    Write-Success "Current version: $currentVersion"
    exit 0
}

Write-Warning "Current version: $currentVersion"

try {
    $newVersion = Get-NewVersion -CurrentVersion $currentVersion -BumpType $Command
    
    if ($newVersion -eq $currentVersion) {
        Write-Warning "Version is already $currentVersion"
        exit 0
    }
    
    Write-Success "New version:     $newVersion"
    
    # Update manifest.json
    Update-Version -NewVersion $newVersion
    Write-Success "`n✓ Updated manifest.json"
    
    # Create git commit and tag if requested
    if (-not $NoCommit) {
        New-GitCommitAndTag -Version $newVersion -CreateTag (-not $NoTag)
    }
    else {
        Write-Success "`n✓ Version bumped to $newVersion"
        Write-Host "`nManual commit required:"
        Write-Warning "  git add src/manifest.json"
        Write-Warning "  git commit -m `"chore: bump version to $newVersion`""
        if (-not $NoTag) {
            Write-Warning "  git tag v$newVersion"
        }
    }
}
catch {
    Write-Error "`nError: $_"
    exit 1
}