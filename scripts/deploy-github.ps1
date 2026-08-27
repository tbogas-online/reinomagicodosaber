# Push para GitHub — o Netlify faz deploy automático se o repo estiver ligado.
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Testes locais..." -ForegroundColor Cyan
node scripts/test-question-engine.js

Write-Host "Gerar versão..." -ForegroundColor Cyan
node scripts/generate-version.js

$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) {
  Write-Host "Este directório não é um repositório git." -ForegroundColor Red
  exit 1
}

Write-Host "Push para origin/$branch (Netlify deploy automático)..." -ForegroundColor Cyan
git push origin $branch

Write-Host ""
Write-Host "Verifica o deploy em:" -ForegroundColor Green
Write-Host "  https://app.netlify.com → o teu site → Deploys"
