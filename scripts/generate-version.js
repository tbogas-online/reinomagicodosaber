const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION_FILE = path.join(PUBLIC, 'version.json');
const CHANGELOG_SOURCE = path.join(__dirname, 'changelog.json');
const CHANGELOG_PUBLIC = path.join(PUBLIC, 'changelog.json');
const INDEX_HTML = path.join(PUBLIC, 'index.html');

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

  const versionToTitle = (version) => {
    const m = String(version || '').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
    if (!m) return '';
    return `${m[3]}/${m[2]}/${m[1]} · ${m[4]}:${m[5]}`;
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
  html = html.replace(
    /question-engine\/issue-codes\.js\?v=[^"]+/g,
    `question-engine/issue-codes.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\/knowledge-key\.js\?v=[^"]+/g,
    `question-engine/knowledge-key.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\/known-facts\.js\?v=[^"]+/g,
    `question-engine/known-facts.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\.js\?v=[^"]+/g,
    `question-engine.js?v=${version}`,
  );
  html = html.replace(
    /app-update\.js\?v=[^"]+/g,
    `app-update.js?v=${version}`,
  );
  html = html.replace(/__APP_BUILD__/g, version);
  fs.writeFileSync(INDEX_HTML, html, 'utf8');
}

const SW_FILE = path.join(PUBLIC, 'sw.js');
if (fs.existsSync(SW_FILE)) {
  let sw = fs.readFileSync(SW_FILE, 'utf8');
  sw = sw.replace(/const APP_BUILD = '[^']*';/, `const APP_BUILD = '${version}';`);
  sw = sw.replace(/__APP_BUILD__/g, version);
  fs.writeFileSync(SW_FILE, sw, 'utf8');
}

const TEST_AI = path.join(PUBLIC, 'test-ai.html');
const TEST_QUESTIONS = path.join(PUBLIC, 'test-questions.html');

function patchTestPageHtml(filePath) {
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(
    /<meta name="app-build" content="[^"]*">/,
    `<meta name="app-build" content="${version}">`,
  );
  html = html.replace(
    /question-engine\/issue-codes\.js\?v=[^"]+/g,
    `question-engine/issue-codes.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\/knowledge-key\.js\?v=[^"]+/g,
    `question-engine/knowledge-key.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\/known-facts\.js\?v=[^"]+/g,
    `question-engine/known-facts.js?v=${version}`,
  );
  html = html.replace(
    /question-engine\.js\?v=[^"]+/g,
    `question-engine.js?v=${version}`,
  );
  html = html.replace(
    /app-update\.js\?v=[^"]+/g,
    `app-update.js?v=${version}`,
  );
  if (!html.includes('app-update.js')) {
    html = html.replace(
      '</body>',
      `  <script src="app-update.js?v=${version}" defer></script>\n</body>`,
    );
  }
  fs.writeFileSync(filePath, html, 'utf8');
}

if (fs.existsSync(TEST_AI)) {
  patchTestPageHtml(TEST_AI);
}
if (fs.existsSync(TEST_QUESTIONS)) {
  patchTestPageHtml(TEST_QUESTIONS);
}

console.log(`Reino Mágico do Saber — versão gerada: ${version}`);
console.log(`Atualização (Portugal): ${updatedAtPortugal}`);
console.log(`Ficheiros: version.json, changelog.json, meta app-build em index.html, sw.js`);
