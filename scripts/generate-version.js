const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION_FILE = path.join(PUBLIC, 'version.json');
const CHANGELOG_SOURCE = path.join(__dirname, 'changelog.json');
const CHANGELOG_PUBLIC = path.join(PUBLIC, 'changelog.json');
const INDEX_HTML = path.join(PUBLIC, 'index.html');
const SW_FILE = path.join(PUBLIC, 'sw.js');
const PRECACHE_START = '// GENERATED_PRECACHE_START';
const PRECACHE_END = '// GENERATED_PRECACHE_END';

const now = new Date();
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}).formatToParts(now);

const get = (name) => parts.find((p) => p.type === name)?.value;
const version = `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
const updatedAtPortugal = `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;

const versionInfo = {
  version,
  updatedAt: now.toISOString(),
  updatedAtPortugal,
  timezone: 'Europe/Lisbon',
};

function bumpLocalAssetVersions(html, build) {
  let next = html.replace(
    /((?:src|href)=["'])([^"'?#]+)(\?v=)[^"']+(["'])/gi,
    (match, pre, assetPath, q, post) => {
      if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith('//')) return match;
      return `${pre}${assetPath}?v=${build}${post}`;
    },
  );
  next = next.replace(
    /((?:src|href)=["'])([^"'?#]+\.(?:js|css))(["'])/gi,
    (match, pre, assetPath, post) => {
      if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith('//')) return match;
      return `${pre}${assetPath}?v=${build}${post}`;
    },
  );
  return next;
}

function extractLocalScriptUrls(html) {
  const urls = new Set(['/index.html']);
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('//')) continue;
    const pathOnly = src.split('#')[0];
    urls.add(pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`);
  }
  urls.add('/manifest.webmanifest');
  urls.add('/favicon.ico');
  urls.add('/icon-any-192.png');
  urls.add('/icon-any-512.png');
  return [...urls].sort();
}

function writePrecacheList(sw, urls) {
  const lines = urls.map((u) => `  '${u.replace(/'/g, "\\'")}',`).join('\n');
  const block = `${PRECACHE_START}\nconst PRECACHE_URLS = [\n${lines}\n];\n${PRECACHE_END}`;
  const pattern = new RegExp(`${PRECACHE_START}[\\s\\S]*?${PRECACHE_END}`);
  if (!pattern.test(sw)) {
    throw new Error('sw.js missing GENERATED_PRECACHE markers');
  }
  return sw.replace(pattern, block);
}

fs.writeFileSync(VERSION_FILE, JSON.stringify(versionInfo, null, 2) + '\n', 'utf8');

if (fs.existsSync(CHANGELOG_SOURCE)) {
  const raw = JSON.parse(fs.readFileSync(CHANGELOG_SOURCE, 'utf8'));
  const normalizeSection = (section, fallbackTitle) => {
    if (Array.isArray(section)) return { title: fallbackTitle, items: section };
    if (section && Array.isArray(section.items)) {
      return { title: section.title || fallbackTitle, items: section.items };
    }
    return { title: fallbackTitle, items: [] };
  };

  const versionToTitle = (v) => {
    const match = String(v || '').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (!match) return '';
    return `${match[3]}/${match[2]}/${match[1]} · ${match[4]}:${match[5]}`;
  };

  const normalizeHistory = (history) => {
    if (!history) return [];
    if (Array.isArray(history)) {
      if (!history.length) return [];
      if (typeof history[0] === 'string') {
        return [{ title: 'Histórico', items: history }];
      }
      return history.map((entry) => ({
        date: entry.date || '',
        version: entry.version || '',
        title: entry.title || versionToTitle(entry.version) || entry.date || 'Histórico',
        items: Array.isArray(entry.items) ? entry.items : [],
      })).filter((entry) => entry.items.length);
    }
    const single = normalizeSection(history, 'Histórico');
    return single.items.length ? [single] : [];
  };

  const changelog = {
    version,
    updatedAtPortugal,
    generatedAt: versionInfo.updatedAt,
    current: normalizeSection(raw.current, 'Versão atual'),
    history: normalizeHistory(raw.history),
  };
  fs.writeFileSync(CHANGELOG_PUBLIC, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
}

if (fs.existsSync(INDEX_HTML)) {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  html = html.replace(
    /<meta name="app-build" content="[^"]*">/,
    `<meta name="app-build" content="${version}">`,
  );
  html = bumpLocalAssetVersions(html, version);
  html = html.replace(/__APP_BUILD__/g, version);
  fs.writeFileSync(INDEX_HTML, html, 'utf8');

  if (fs.existsSync(SW_FILE)) {
    const precacheUrls = extractLocalScriptUrls(html);
    let sw = fs.readFileSync(SW_FILE, 'utf8');
    sw = sw.replace(/const APP_BUILD = '[^']*';/, `const APP_BUILD = '${version}';`);
    sw = writePrecacheList(sw, precacheUrls);
    fs.writeFileSync(SW_FILE, sw, 'utf8');
  }
} else if (fs.existsSync(SW_FILE)) {
  let sw = fs.readFileSync(SW_FILE, 'utf8');
  sw = sw.replace(/const APP_BUILD = '[^']*';/, `const APP_BUILD = '${version}';`);
  fs.writeFileSync(SW_FILE, sw, 'utf8');
}

const ADMIN_DIR = path.join(PUBLIC, 'admin');
const TEST_AI = path.join(ADMIN_DIR, 'test-ai.html');
const TEST_QUESTIONS = path.join(ADMIN_DIR, 'test-questions.html');

function patchTestPageHtml(filePath) {
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(
    /<meta name="app-build" content="[^"]*">/,
    `<meta name="app-build" content="${version}">`,
  );
  html = bumpLocalAssetVersions(html, version);
  if (!html.includes('app-update.js')) {
    html = html.replace(
      '</body>',
      `  <script src="/app-update.js?v=${version}" defer></script>\n</body>`,
    );
  }
  fs.writeFileSync(filePath, html, 'utf8');
}

if (fs.existsSync(TEST_AI)) patchTestPageHtml(TEST_AI);
if (fs.existsSync(TEST_QUESTIONS)) patchTestPageHtml(TEST_QUESTIONS);

console.log(`Reino Mágico do Saber — versão gerada: ${version}`);
console.log(`Atualização (Portugal): ${updatedAtPortugal}`);
console.log('Ficheiros: version.json, changelog.json, index.html, sw.js (precache sincronizado)');
