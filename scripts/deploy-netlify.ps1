# Deploy completo (estático + funções Netlify) — Reino Mágico do Saber
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Gerar versão..." -ForegroundColor Cyan
node scripts/generate-version.js

Write-Host "Redirects Netlify..." -ForegroundColor Cyan
$redirectsNetlify = Join-Path $PSScriptRoot "..\public\_redirects.netlify"
$redirectsDest = Join-Path $PSScriptRoot "..\public\_redirects"
if (Test-Path $redirectsNetlify) {
  Copy-Item -Force $redirectsNetlify $redirectsDest
} else {
  Write-Host "  (aviso: _redirects.netlify em falta, mantem public\_redirects)" -ForegroundColor Yellow
}

Write-Host "Instalar dependências (functions)..." -ForegroundColor Cyan
npm install --no-fund --no-audit

Write-Host "Deploy produção (public + netlify/functions)..." -ForegroundColor Cyan
# --skip-functions-cache força reenvio das funções se o CDN ignorar alterações
npx --yes netlify-cli deploy --prod --build --skip-functions-cache

Write-Host ""
Write-Host "Verificar:" -ForegroundColor Green
Write-Host "  GET  https://reinomagicodosaber.netlify.app/api/ai-status"
Write-Host "  POST https://reinomagicodosaber.netlify.app/api/generate"
