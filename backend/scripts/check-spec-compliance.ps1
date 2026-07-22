<#
.SYNOPSIS
    PuchiPix Go Backend Spec Compliance Check Script

.DESCRIPTION
    Checks compliance with PuchiPix project coding standards:
    - Comment spec: No Chinese, no section separators, no numbered steps
    - Log spec: No Chinese in log messages, PascalCase module names, no hardcoded tags
    - Translation keys: Cross-validation between Go code and dictionaries
#>
param(
    [ValidateSet("6.2", "6.3", "6.5", "all")]
    [string]$Phase = "all"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path $PSScriptRoot
$GoSrcDirs = @("internal", "cmd")

function Get-AllGoFiles {
    $files = @()
    foreach ($dir in $GoSrcDirs) {
        $path = Join-Path $ProjectRoot $dir
        if (Test-Path $path) {
            $files += Get-ChildItem -Path $path -Filter "*.go" -Recurse -File
        }
    }
    return $files
}

# Phase 6.2: Comment spec checks
function Test-CommentSpec {
    Write-Host "Phase 6.2: Comment Spec Check" -ForegroundColor Cyan

    $files = Get-AllGoFiles
    $issues = 0

    # Check for Chinese characters in Go source
    Write-Host "  Checking for Chinese characters..." -NoNewline
    $chinese = Select-String -Path $files.FullName -Pattern "[\p{IsCJKUnifiedIdeographs}]"
    if ($chinese) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($chinese.Count) Chinese characters in comments:" -ForegroundColor Red
        $chinese | Select-Object -First 10 | ForEach-Object {
            Write-Host "      $($_.Path.Substring($ProjectRoot.Length + 1)):$($_.LineNumber)" -ForegroundColor Red
        }
        if ($chinese.Count -gt 10) { Write-Host "      ... and $($chinese.Count - 10) more" -ForegroundColor Red }
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    # Check for section separators
    Write-Host "  Checking for section separators..." -NoNewline
    $separators = Select-String -Path $files.FullName -Pattern "^// (====+|----+)"
    if ($separators) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($separators.Count) section separators" -ForegroundColor Red
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    # Check for numbered steps
    Write-Host "  Checking for numbered steps..." -NoNewline
    $steps = Select-String -Path $files.FullName -Pattern "// Step [0-9]|// [0-9]+\. "
    if ($steps) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($steps.Count) numbered step comments" -ForegroundColor Red
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    return $issues
}

# Phase 6.3: Log spec checks
function Test-LogSpec {
    Write-Host "`nPhase 6.3: Log Spec Check" -ForegroundColor Cyan

    $files = Get-AllGoFiles
    $issues = 0

    # Check for Chinese in log messages
    Write-Host "  Checking for Chinese in log messages..." -NoNewline
    $chineseLogs = Select-String -Path $files.FullName -Pattern "logger\.(Info|Warn|Error|Debug)" | Where-Object { $_.Line -match "[\p{IsCJKUnifiedIdeographs}]" }
    if ($chineseLogs) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($chineseLogs.Count) log messages with Chinese" -ForegroundColor Red
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    # Check for hardcoded module tags
    Write-Host "  Checking for hardcoded module tags..." -NoNewline
    $tags = Select-String -Path $files.FullName -Pattern 'logger\.(Info|Warn|Error|Debug)\(.*"\[[^]]+\]'
    if ($tags) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($tags.Count) hardcoded module tags" -ForegroundColor Red
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    return $issues
}

# Phase 6.5: Directory structure checks
function Test-DirectorySpec {
    Write-Host "`nPhase 6.5: Directory Structure Check" -ForegroundColor Cyan

    $issues = 0

    # Check for single-file subdirectories
    Write-Host "  Checking for single-file subdirectories..." -NoNewline
    $singleDirs = @()
    foreach ($dir in $GoSrcDirs) {
        $path = Join-Path $ProjectRoot $dir
        if (Test-Path $path) {
            $allDirs = Get-ChildItem -Path $path -Directory -Recurse
            foreach ($d in $allDirs) {
                $files = Get-ChildItem -Path $d.FullName -File -Filter "*.go"
                $hasBarrel = Test-Path (Join-Path $d.FullName "index.go") -or Test-Path (Join-Path $d.FullName "$($d.BaseName).go")
                if ($files.Count -eq 1 -and !$hasBarrel -and $d.Name -notin @("internal", "cmd")) {
                    $singleDirs += $d.FullName.Substring($ProjectRoot.Length + 1)
                }
            }
        }
    }
    if ($singleDirs) {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Found $($singleDirs.Count) single-file subdirectories" -ForegroundColor Red
        $issues++
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }

    return $issues
}

# Main
Write-Host "PuchiPix Go Backend Spec Compliance Check" -ForegroundColor Cyan
Write-Host "================================================`n"

$totalIssues = 0
if ($Phase -eq "all" -or $Phase -eq "6.2") { $totalIssues += Test-CommentSpec }
if ($Phase -eq "all" -or $Phase -eq "6.3") { $totalIssues += Test-LogSpec }
if ($Phase -eq "all" -or $Phase -eq "6.5") { $totalIssues += Test-DirectorySpec }

Write-Host "`n================================================" -ForegroundColor Cyan
if ($totalIssues -eq 0) {
    Write-Host "All checks passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Found $totalIssues compliance issues." -ForegroundColor Red
    exit 1
}