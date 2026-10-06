'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { loadEnvLocal } = require('./load-env');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');

loadEnvLocal();

function nodeSupportsSystemCa() {
  const [maj, min] = String(process.versions.node || '0.0').split('.').map((n) => Number(n) || 0);
  return maj >= 24 || (maj === 23 && min >= 8) || (maj === 22 && min >= 15);
}

/** Proxy/inspeção SSL da empresa: o Node ignora o armazém de certificados do Windows sem esta flag. */
function withSystemCaEnv(env) {
  if (!nodeSupportsSystemCa()) return { ...env };
  const next = { ...env };
  const current = String(next.NODE_OPTIONS || '').trim();
  if (!current.includes('--use-system-ca')) {
    next.NODE_OPTIONS = current ? `${current} --use-system-ca` : '--use-system-ca';
  }
  return next;
}

process.env.DEV_LOCAL = '1';
process.env.NETLIFY_DEV = 'true';

if (!process.env.GENERATE_ALLOW_PUBLIC) {
  process.env.GENERATE_ALLOW_PUBLIC = 'true';
}

if (!fs.existsSync(envPath)) {
  console.warn('');
  console.warn('Aviso: .env.local não encontrado — copia .env.example e preenche as variáveis.');
  console.warn('');
}

const hasAiKey = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
  .some((k) => String(process.env[k] || '').trim());
if (!hasAiKey) {
  console.warn('');
  console.warn('Aviso: nenhuma chave de IA em .env.local (GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).');
  console.warn('  → O jogo mostra «IA offline» em local até adicionares pelo menos uma chave.');
  console.warn('  → Alternativa: DEV_LIVE=1 no .env.local + netlify link (herda env do site Netlify).');
  console.warn('');
}

const gen = spawnSync(process.execPath, ['scripts/generate-version.js'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
if (gen.status !== 0) process.exit(gen.status || 1);

const port = process.env.DEV_PORT || '8888';
const wantsLive = process.env.DEV_LIVE === '1';
// Com chaves em .env.local, offline garante que as functions usam esses valores
// (DEV_LIVE=1 injecta o contexto «dev» do Netlify e pode sobrescrever chaves válidas).
const useOffline = hasAiKey || !wantsLive;

const npxArgs = ['--yes', 'netlify-cli', 'dev', '--port', port];
if (useOffline) {
  npxArgs.push('--offline');
} else {
  npxArgs.push('--context', 'production');
}

const childEnv = withSystemCaEnv(process.env);

console.log('');
console.log('=== Reino Mágico — desenvolvimento local ===');
console.log(`  Jogo:      http://localhost:${port}/`);
console.log(`  Admin:     http://localhost:${port}/admin-reports.html`);
console.log(`  Teste IA:  http://localhost:${port}/admin/test-ai.html`);
if (useOffline) {
  console.log('  Modo:      offline (.env.local → functions; zero invocações Netlify).');
  if (wantsLive && hasAiKey) {
    console.log('  Nota:      DEV_LIVE=1 ignorado — já tens chaves de IA em .env.local.');
  }
} else {
  console.log('  Modo:      live (--context production; requer netlify link).');
}
console.log('  Parar:     Ctrl+C');
if (nodeSupportsSystemCa()) {
  console.log('  TLS:       --use-system-ca (certificados do sistema / proxy da empresa)');
}
console.log('');

const child = spawn('npx', npxArgs, {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
