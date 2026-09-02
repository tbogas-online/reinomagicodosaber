'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const script = isWin
  ? path.join(__dirname, 'deploy-netlify.ps1')
  : path.join(__dirname, 'deploy-netlify.sh');

function runDeploy() {
  if (isWin) {
    const r = spawnSync(
      'powershell',
      ['-ExecutionPolicy', 'Bypass', '-File', script],
      { cwd: root, stdio: 'inherit' },
    );
    process.exit(r.status ?? 1);
  }
  const r = spawnSync('bash', [script], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

if (process.env.DEPLOY_LIVE_CONFIRM === '1') {
  runDeploy();
  return;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Publicar em LIVE no Netlify? (sim/não): ', (answer) => {
  rl.close();
  if (String(answer || '').trim().toLowerCase() !== 'sim') {
    console.log('Deploy cancelado.');
    process.exit(0);
  }
  runDeploy();
});
