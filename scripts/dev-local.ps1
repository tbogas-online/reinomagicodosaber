# Desenvolvimento local — site + Netlify Functions sem gastar créditos em produção.
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path ".env.local")) {
  Write-Host "Aviso: copia .env.example para .env.local e preenche as variáveis." -ForegroundColor Yellow
}

Write-Host "Instalar dependências..." -ForegroundColor Cyan
npm install --no-fund --no-audit

Write-Host "Arrancar servidor local (netlify dev --offline)..." -ForegroundColor Cyan
node scripts/dev-local.js
