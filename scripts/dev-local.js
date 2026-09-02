'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { loadEnvLocal } = require('./load-env');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');

loadEnvLocal();

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

const gen = spawnSync(process.execPath, ['scripts/generate-version.js'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
if (gen.status !== 0) process.exit(gen.status || 1);

const port = process.env.DEV_PORT || '8888';
const offline = process.env.DEV_LIVE !== '1';

const npxArgs = ['--yes', 'netlify-cli', 'dev', '--port', port];
if (offline) npxArgs.push('--offline');

console.log('');
console.log('=== Reino Mágico — desenvolvimento local ===');
console.log(`  Jogo:      http://localhost:${port}/`);
console.log(`  Admin:     http://localhost:${port}/admin-reports.html`);
console.log(`  Teste IA:  http://localhost:${port}/admin/test-ai.html`);
if (offline) {
  console.log('  Modo:      offline (zero invocações Netlify em produção).');
} else {
  console.log('  Modo:      live (env do site Netlify; functions ainda locais).');
}
console.log('  Parar:     Ctrl+C');
console.log('');

const child = spawn('npx', npxArgs, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
