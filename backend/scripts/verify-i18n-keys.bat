@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -Command "& scripts\verify-i18n-keys.ps1"