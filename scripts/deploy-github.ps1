# Deploy via GitHub — faz push para main; o workflow .github/workflows/deploy.yml publica o site.
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Testes locais..." -ForegroundColor Cyan
node scripts/test-question-engine.js

Write-Host "Gerar versão..." -ForegroundColor Cyan
node scripts/generate-version.js

$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
if (-not $branch) {
  Write-Host "Este directório não é um repositório git. Cria o repo no GitHub e faz git init primeiro." -ForegroundColor Red
  exit 1
}

Write-Host "Push para origin/$branch (dispara GitHub Actions)..." -ForegroundColor Cyan
git push origin $branch

Write-Host ""
Write-Host "Depois do workflow:" -ForegroundColor Green
Write-Host "  GitHub → Actions → Deploy"
Write-Host "  Cloudflare Pages → o teu projecto → URL *.pages.dev"
Write-Host ""
Write-Host "Secrets necessários no GitHub (Settings → Secrets and variables → Actions):"
Write-Host "  CLOUDFLARE_API_TOKEN"
Write-Host "  CLOUDFLARE_ACCOUNT_ID"
