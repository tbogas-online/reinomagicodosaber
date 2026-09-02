#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Gerar versão..."
node scripts/generate-version.js

echo "Redirects Netlify..."
cp -f public/_redirects.netlify public/_redirects

echo "Instalar dependências (functions)..."
npm install --no-fund --no-audit

echo "Deploy produção (public + netlify/functions)..."
npx --yes netlify-cli deploy --prod --build --skip-functions-cache

echo ""
echo "Verificar:"
echo "  GET  https://reinomagicodosaber.netlify.app/api/ai-status"
