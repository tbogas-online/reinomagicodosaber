'use strict';

/**
 * Netlify [build].ignore — controla deploys automáticos via Git.
 * Exit 0 = não fazer build (poupa créditos).
 * Exit 1 = fazer build.
 *
 * Deploy em produção:
 *   - Manual: npm run deploy:live  (ou scripts/deploy-netlify.ps1)
 *   - Via Git: mensagem de commit com [deploy] ou [live]
 */

const { execSync } = require('child_process');

const TAG = /\[(?:deploy|live)\]/i;

function getCommitMessage() {
  const fromEnv = process.env.COMMIT_REF_MESSAGE || process.env.COMMIT_MESSAGE || '';
  if (fromEnv.trim()) return fromEnv.trim();
  const ref = process.env.COMMIT_REF || 'HEAD';
  try {
    return execSync(`git log -1 --format=%B ${ref}`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const message = getCommitMessage();
if (TAG.test(message)) {
  console.log('[should-netlify-build] Tag [deploy]/[live] encontrada — a construir.');
  process.exit(1);
}

console.log('[should-netlify-build] Build ignorado (sem [deploy] ou [live] no commit).');
console.log('  Testa em local: npm run dev');
console.log('  Publicar: npm run deploy:live  ou  git commit -m "… [deploy]"');
process.exit(0);
