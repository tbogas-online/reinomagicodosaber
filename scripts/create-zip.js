const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PARENT = path.dirname(ROOT);
const PUBLIC = path.join(ROOT, 'public');
const VERSION_FILE = path.join(PUBLIC, 'version.json');

if (!fs.existsSync(VERSION_FILE)) {
  console.error('version.json em falta. Executa primeiro: node scripts/generate-version.js');
  process.exit(1);
}

const versionInfo = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
const version = versionInfo.version;
const zipName = `reino-magico-deploy-flat-v${version}.zip`;
const zipPath = path.join(PARENT, zipName);
const tempDir = path.join(require('os').tmpdir(), `reino-magico-flat-${version}`);

const supportItems = ['netlify', 'functions', 'scripts', 'package.json', 'LEIA-ME.md'];

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

rmDir(tempDir);
fs.mkdirSync(tempDir, { recursive: true });

// Ficheiros do site na RAIZ do zip (index.html, version.json, etc.).
// Isto garante que o deploy manual no Netlify substitui /index.html.
for (const entry of fs.readdirSync(PUBLIC)) {
  fs.cpSync(path.join(PUBLIC, entry), path.join(tempDir, entry), { recursive: true });
}

const redirectsNetlify = path.join(PUBLIC, '_redirects.netlify');
const redirectsDest = path.join(tempDir, '_redirects');
if (fs.existsSync(redirectsNetlify)) {
  fs.copyFileSync(redirectsNetlify, redirectsDest);
}

for (const item of supportItems) {
  const src = path.join(ROOT, item);
  const dest = path.join(tempDir, item);
  if (!fs.existsSync(src)) {
    console.warn(`Aviso: ${item} não encontrado, a ignorar.`);
    continue;
  }
  fs.cpSync(src, dest, { recursive: true });
}

const tomlSrc = path.join(ROOT, 'netlify.toml');
const tomlDest = path.join(tempDir, 'netlify.toml');
if (fs.existsSync(tomlSrc)) {
  const toml = fs.readFileSync(tomlSrc, 'utf8').replace(
    /publish\s*=\s*"public"/,
    'publish = "."',
  );
  fs.writeFileSync(tomlDest, toml, 'utf8');
}

const indexPath = path.join(tempDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error('ERRO: index.html não encontrado na raiz do zip.');
  process.exit(1);
}
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const indexKb = (Buffer.byteLength(indexHtml, 'utf8') / 1024).toFixed(0);
const hasAiTest = indexHtml.includes('btn-ai-test-page');
const hasAiBlock = indexHtml.includes('settings-ai-block');
console.log(`index.html: ${indexKb} KB · teste IA: ${hasAiTest ? 'sim' : 'NÃO'} · bloco IA: ${hasAiBlock ? 'sim' : 'NÃO'}`);
if (!hasAiTest || !hasAiBlock) {
  console.error('ERRO: index.html no zip não contém as definições de IA. Corre npm run build antes do zip.');
  process.exit(1);
}

const genPath = path.join(tempDir, 'netlify', 'functions', 'generate.js');
if (!fs.existsSync(genPath)) {
  console.error('ERRO: netlify/functions/generate.js em falta no zip.');
  process.exit(1);
}
const gen = fs.readFileSync(genPath, 'utf8');
if (!gen.includes('provider_strict')) {
  console.error('ERRO: netlify/functions/generate.js sem provider_strict.');
  process.exit(1);
}
const testAiPath = path.join(tempDir, 'test-ai.html');
if (fs.existsSync(testAiPath)) {
  const testAi = fs.readFileSync(testAiPath, 'utf8');
  if (!testAi.includes('provider_strict')) {
    console.error('ERRO: test-ai.html sem provider_strict no pedido.');
    process.exit(1);
  }
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const ps = [
  `$temp = '${tempDir.replace(/'/g, "''")}'`,
  `$dest = '${zipPath.replace(/'/g, "''")}'`,
  'Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $dest -Force',
].join('; ');

execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
rmDir(tempDir);

const sizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
console.log(`\nZip criado: ${zipPath}`);
console.log(`Tamanho: ${sizeMb} MB`);
console.log('Estrutura: index.html na raiz do zip (não dentro de public/).');
