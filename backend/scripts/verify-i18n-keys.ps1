<#
.SYNOPSIS
    Validates Go i18n translation keys against dictionary files

.DESCRIPTION
    Extracts all i18n.T() and i18n.TFromRequest() calls from Go source code
    and cross-checks them against the embedded JSON dictionaries.
#>
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path $PSScriptRoot
$GoSrcDirs = @("internal", "cmd")
$LocaleDir = Join-Path $ProjectRoot "internal\i18n\locales"

Write-Host "Extracting i18n keys from Go source..." -ForegroundColor Cyan

# Find all i18n.T*() calls using Select-String
$goCalls = @()
foreach ($dir in $GoSrcDirs) {
    $path = Join-Path $ProjectRoot $dir
    if (Test-Path $path) {
        $results = Get-ChildItem -Path $path -Filter "*.go" -Recurse | Select-String -Pattern 'i18n\.(T|TFromRequest)'
        foreach ($m in $results) {
            if ($m.Line -match '"([^"]+)"\)') {
                $goCalls += @{
                    Key = $Matches[1]
                    File = $m.Path.Substring($ProjectRoot.Length + 1)
                    Line = $m.LineNumber
                }
            }
        }
    }
}

$goKeys = $goCalls | Group-Object -Property Key | Select-Object Name, Count
Write-Host "  Found $($goKeys.Count) unique keys in Go code`n"

# Load zh-CN dictionary
$zhCNPath = Join-Path $LocaleDir "zh-CN.json"
if (!(Test-Path $zhCNPath)) {
    Write-Host "ERROR: $zhCNPath not found. Run npx tsx ../../frontend/scripts/export-i18n-json.ts first." -ForegroundColor Red
    exit 1
}

$zhCNContent = Get-Content $zhCNPath -Raw -Encoding UTF8
$zhCN = $zhCNContent | ConvertFrom-Json
$dictKeys = $zhCN.PSObject.Properties | Select-Object -ExpandProperty Name
Write-Host "  Loaded zh-CN dictionary with $($dictKeys.Count) keys`n"

# Find missing keys in dictionary
$missingInDict = @()
foreach ($gk in $goKeys) {
    if ($gk.Name -notin $dictKeys) {
        $missingInDict += $gk
    }
}

# Find orphan keys in dictionary (not used in Go)
$orphanInDict = $dictKeys | Where-Object { $_ -notin $goKeys.Name }

Write-Host "Key Validation Results:" -ForegroundColor Cyan
Write-Host "================================`n"

if ($missingInDict.Count -eq 0) {
    Write-Host "✓ All Go code keys exist in dictionary" -ForegroundColor Green
} else {
    Write-Host "✗ Found $($missingInDict.Count) keys used in Go but missing from dictionary:" -ForegroundColor Red
    foreach ($m in $missingInDict | Select-Object -First 20) {
        Write-Host "  - $($m.Name) (used $($m.Count) times)" -ForegroundColor Red
    }
    if ($missingInDict.Count -gt 20) {
        Write-Host "  ... and $($missingInDict.Count - 20) more" -ForegroundColor Red
    }
}

Write-Host ""

if ($orphanInDict.Count -eq 0) {
    Write-Host "✓ No orphan keys in dictionary" -ForegroundColor Green
} else {
    Write-Host "⚠ Found $($orphanInDict.Count) orphan keys in dictionary (not used in Go):" -ForegroundColor Yellow
    foreach ($o in $orphanInDict | Select-Object -First 20) {
        Write-Host "  - $o" -ForegroundColor Yellow
    }
    if ($orphanInDict.Count -gt 20) {
        Write-Host "  ... and $($orphanInDict.Count - 20) more" -ForegroundColor Yellow
    }
}

Write-Host ""

if ($missingInDict.Count -gt 0) {
    Write-Host "FAILED: Add missing keys to ../../frontend/src/lib/i18n/locales/api/zh-CN.ts and re-export" -ForegroundColor Red
    exit 1
} else {
    Write-Host "PASSED: All keys validated successfully" -ForegroundColor Green
    exit 0
}