#!/usr/bin/env node
'use strict';

const {
  parseRssItems,
  firstSentences,
  answerFromTitle,
  matchesWords,
  isUsableTitle,
  isQuizLead,
  quizAnswerFromArticle,
  decodeBytes,
  extractNamedAnswer,
} = require('./lib/rss-html');
const { extractLead: extractRtpLead, toRecord: rtpToRecord, collectRtpRecords } = require('./lib/rtp-ensina-collect');
const { collectCienciaVivaRecords, toRecord: cvToRecord } = require('./lib/ciencia-viva-collect');
const {
  collectArquivoRecords,
  toRecord: arqToRecord,
  cleanArchivedLead,
  searchQuery,
  parseCdxJsonl,
  replayUrl,
} = require('./lib/arquivo-pt-collect');
const {
  collectBnpRecords,
  toRecord: bnpToRecord,
  searchQuery: bnpSearchQuery,
  parseCatalogBibIds,
  parseOaiDc,
  displayAuthor,
  yearFromDate,
  buildFact,
  catalogPermalink,
} = require('./lib/bnp-collect');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const RTP_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[Fitoplâncton, o gigante invisível]]></title>
  <link>https://ensina.rtp.pt/artigo/fitoplancton-o-gigante-invisivel/</link>
  <guid isPermaLink="false">https://ensina.rtp.pt/?post_type=artigo&amp;p=71359</guid>
</item>
<item>
  <title>Conferência A Inteligência Artificial e a Educação – painel 2</title>
  <link>https://ensina.rtp.pt/artigo/conferencia-painel-2/</link>
  <guid>https://ensina.rtp.pt/?post_type=artigo&amp;p=52893</guid>
</item>
</channel></rss>`;

const RTP_HTML = `<html><body>
<h1>Fitoplâncton, o gigante invisível</h1>
<p>Estima-se que metade do oxigénio gerado na Terra tenha origem nos oceanos. Grande parte é produzida pelo fitoplâncton, que é também a base da cadeia alimentar marinha.</p>
</body></html>`;

const CV_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[Porque é que o mar é azul?]]></title>
  <link>http://imprensaregional.cienciaviva.pt/conteudos/artigos/?accao=showartigo&amp;id_artigocir=1604</link>
  <description><![CDATA[A cor azul do oceano deve-se sobretudo à forma como a água absorve e dispersa a luz solar, e não só ao reflexo do céu.]]></description>
</item>
<item>
  <title>Estamos a contratar um programador</title>
  <link>http://imprensaregional.cienciaviva.pt/conteudos/artigos/?accao=showartigo&amp;id_artigocir=1</link>
  <description>A Ciência Viva pretende contratar um programador para o departamento de sistemas.</description>
</item>
<item>
  <title>O comportamento escondido dos supercondutores</title>
  <link>http://imprensaregional.cienciaviva.pt/conteudos/artigos/?accao=showartigo&amp;id_artigocir=1600</link>
  <description>Estudo liderado por Nuno Peres, da Universidade do Minho, foi publicado na conceituada revista científica PNAS e abre portas a um entendimento da física fundamental dos supercondutores.</description>
</item>
</channel></rss>`;

const ARQ_WIKI = JSON.stringify([
  'Afonso',
  ['Afonso Henriques', 'Afonso Henriques (desambiguação)'],
  ['', ''],
  [
    'https://pt.wikipedia.org/wiki/Afonso_Henriques',
    'https://pt.wikipedia.org/wiki/Afonso_Henriques_(desambiguacao)',
  ],
]);
const ARQ_CDX = `${JSON.stringify({
  urlkey: 'org,wikipedia,pt)/wiki/afonso_i_de_portugal',
  timestamp: '20100101000000',
  url: 'http://pt.wikipedia.org/wiki/Afonso_I_de_Portugal',
  mime: 'text/html',
  status: '200',
  digest: 'abcdef0123456789deadbeefcafebabe',
  collection: 'AWP1',
})}\n`;
const ARQ_HTML = `<html><body>
<p>Afonso Henriques (Guimarães, 1109) foi o primeiro rei de Portugal e fundador da dinastia afonsina.</p>
</body></html>`;

const BNP_HTML = `<html><body>
<a class="smallAnchor" href="javascript:buildNewList('https%3A%2F%2Fcatalogo.bnportugal.gov.pt%2Fipac20%2Fipac.jsp%3Furi%3Dfull%3D3100024%7E%21656%7E%210')">Afonso Henriques</a>
<a href="/ipac20/ipac.jsp?uri=full=3100024~!3882~!1">Crónica</a>
</body></html>`;
const BNP_OAI = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH><GetRecord><record>
<header><identifier>oai:oai.bn.pt:catalogo/656</identifier></header>
<metadata><oai_dc:dc>
<dc:title>Vasco Duro, o indomável: &#x98;uma &#x9c;história no tempo de D. Afonso Henriques</dc:title>
<dc:creator>Pinto, Roussado, 1926-1985</dc:creator>
<dc:date>[D.L. 1980]</dc:date>
<dc:type>material textual, impresso</dc:type>
<dc:language>por</dc:language>
<dc:identifier>Id. do registo: 656</dc:identifier>
</oai_dc:dc></metadata>
</record></GetRecord></OAI-PMH>`;
const BNP_OAI_EN = `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH><GetRecord><record>
<header><identifier>oai:oai.bn.pt:catalogo/3882</identifier></header>
<metadata><oai_dc:dc>
<dc:title>Macau: past and present</dc:title>
<dc:creator>Colóquio Internacional "Macau : past and present", 2012</dc:creator>
<dc:date>2015</dc:date>
<dc:language>eng</dc:language>
<dc:type>material textual, impresso</dc:type>
</oai_dc:dc></metadata>
</record></GetRecord></OAI-PMH>`;

console.log('Colectores RTP, Ciência Viva, Arquivo.pt e BNP — testes\n');

const rtpItems = parseRssItems(RTP_RSS);
assert('RSS RTP tem 2 itens', rtpItems.length === 2);
assert('título RTP', rtpItems[0].title.includes('Fitoplâncton'));
assert('id RTP no guid', /p=71359/.test(rtpItems[0].guid));
assert('rejeita conferência', !isUsableTitle(rtpItems[1].title));
assert('lead RTP', extractRtpLead(RTP_HTML).includes('oxigénio'));
assert('primeira frase', firstSentences(extractRtpLead(RTP_HTML)).includes('oxigénio'));
assert('resposta do título', answerFromTitle('Fitoplâncton, o gigante invisível') === 'Fitoplâncton');

const rtpRecord = rtpToRecord(20, rtpItems[0], extractRtpLead(RTP_HTML), 'ciencia');
assert('id facto RTP', rtpRecord.knowledge_id === 'knw-cat20-rtp-71359');
assert('fonte RTP Ensina', rtpRecord.source === 'RTP Ensina');
assert('resposta V/F', rtpRecord.answer === 'Verdadeiro');
assert('URL Ensina', /ensina\.rtp\.pt/.test(rtpRecord.source_url));
assert('petanca do facto', quizAnswerFromArticle('Qual é o jogo que se joga a pés juntos?', 'Chama-se petanca e começou a ser jogado há muito tempo, no sul de França.', 15) === 'Petanca');
assert('karaté da aula', quizAnswerFromArticle('Histórias do Lucas', 'Vamos mexer o corpo numa aula de karaté. O quê?', 15) === 'Karaté');
assert('ignora série sem resposta', quizAnswerFromArticle('Jovens Talentos', 'Este desporto é olímpico e precisa de paredes. Ou muros altos.', 15) === '');
assert('não usa pergunta como resposta', quizAnswerFromArticle('Qual é o jogo que se joga a pés juntos?', 'Este desporto é olímpico e precisa de paredes.', 15) === '');
assert('título só se aparece no facto', quizAnswerFromArticle('Maratona', 'A maratona é uma corrida muito longa, inspirada numa lenda antiga.', 15) === 'Maratona');
assert('rejeita manchete longa', quizAnswerFromArticle('O comportamento escondido dos supercondutores', 'Estudo liderado por Nuno Peres abre portas aos supercondutores.', 4) === '');

const cvWin1252 = decodeBytes(Uint8Array.from([
  0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x65, 0x6e, 0x63, 0x6f, 0x64, 0x69, 0x6e, 0x67, 0x3d, 0x22,
  0x77, 0x69, 0x6e, 0x64, 0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x32, 0x22, 0x3f, 0x3e,
  0x63, 0x69, 0x65, 0x6e, 0x74, 0xed, 0x66, 0x69, 0x63, 0x61, 0x20, 0x66, 0xed, 0x73, 0x69, 0x63, 0x61,
]), 'application/xml');
assert('decodifica windows-1252', cvWin1252.includes('científica') && cvWin1252.includes('física'), cvWin1252);
assert('não deixa replacement', !cvWin1252.includes('\uFFFD'));

const cvItems = parseRssItems(CV_RSS);
assert('RSS Ciência Viva', cvItems.length === 3);
const cvRecord = cvToRecord(20, cvItems[0]);
assert('id facto CV', cvRecord.knowledge_id === 'knw-cat20-cv-1604');
assert('fonte Ciência Viva', cvRecord.source === 'Ciência Viva');
assert('facto do lead', cvRecord.fact.includes('oceano'));
assert('CV aceita lead com acentos', isQuizLead(cvItems[0].description));
assert('CV rejeita comunicado de imprensa', cvToRecord(20, cvItems[2]) === null);
assert('segundo intercalar', extractNamedAnswer('Chama-se "segundo intercalar", foi criado em 1972 e vai ser aplicado este ano.', { chamaSeOnly: true }) === 'Segundo intercalar');
assert('CV não usa jogo de tabuleiro', quizAnswerFromArticle('Livro e jogo digitais', 'Agora lançados em formato digital, o livro e o jogo de tabuleiro ensinam vírus.', 4, { allowTitle: false, chamaSeOnly: true }) === '');
assert('filtra palavras', matchesWords('fitoplâncton oxigénio', ['oxigénio']));
assert('palavras falham', !matchesWords('fitoplâncton', ['girafa']));
assert('título wiki no travessão', answerFromTitle('Afonso Henriques – Wikipédia, a enciclopédia livre') === 'Afonso Henriques');
assert('consulta Arquivo.pt por categoria', searchQuery(3, []) === 'Afonso Henriques');
assert('consulta Arquivo.pt usa palavras', searchQuery(3, ['Tejo']) === 'Tejo');
assert('CDX JSONL', parseCdxJsonl(ARQ_CDX)[0]?.timestamp === '20100101000000');
assert('URL replay original', replayUrl('20100101000000', 'http://pt.wikipedia.org/wiki/Afonso_I_de_Portugal') === 'https://arquivo.pt/noFrame/replay/20100101000000id_/http://pt.wikipedia.org/wiki/Afonso_I_de_Portugal');
assert('lead Arquivo.pt limpa snippet', cleanArchivedLead('Afonso Henriques Origem: Wikipédia, a enciclopédia livre. Foi o primeiro rei de Portugal.').includes('primeiro rei'));
assert('entidades HTML', /Wikipédia/.test(cleanArchivedLead('Wikip&eacute;dia: Afonso Henriques foi o primeiro rei de Portugal.')) && /Guimarães/.test(cleanArchivedLead('Nasceu em Guimar&atilde;es e foi o primeiro rei de Portugal.')));
assert('salta infobox wiki', /primeiro rei/.test(cleanArchivedLead('D. Afonso Henriques Retrato 1312-1325 Conde de Portucale Reinado 12 de maio de 1112. Afonso Henriques (Guimarães, 1109) foi o primeiro rei de Portugal.')));

const arqItem = {
  title: 'Afonso Henriques – Wikipédia, a enciclopédia livre',
  originalURL: 'https://pt.wikipedia.org/wiki/Afonso_I_de_Portugal',
  linkToArchive: 'https://arquivo.pt/wayback/20100101000000/https://pt.wikipedia.org/wiki/Afonso_I_de_Portugal',
  digest: 'abcdef0123456789deadbeefcafebabe',
  snippet: 'Afonso Henriques (Guimarães, 1109) foi o primeiro rei de Portugal.',
};
const arqRecord = arqToRecord(3, arqItem, arqItem.snippet);
assert('id facto Arquivo.pt', arqRecord.knowledge_id === 'knw-cat3-arq-abcdef0123456789');
assert('fonte Arquivo.pt', arqRecord.source === 'Arquivo.pt');
assert('resposta do artigo arquivado', arqRecord.answer === 'Afonso Henriques');
assert('V/F Arquivo.pt', arqToRecord(20, arqItem, arqItem.snippet).answer === 'Verdadeiro');
assert('consulta BNP por categoria', bnpSearchQuery(3, []) === 'Afonso Henriques');
assert('consulta BNP usa palavras', bnpSearchQuery(3, ['Camões']) === 'Camões');
assert('IDs do catálogo BNP', parseCatalogBibIds(BNP_HTML).join() === '656,3882');
assert('inverte autor BNP', displayAuthor('Pinto, Roussado, 1926-1985') === 'Roussado Pinto');
assert('ignora colóquio BNP', displayAuthor('Colóquio Internacional "Macau : past and present", 2012') === '');
assert('ano BNP com D.L.', yearFromDate('[D.L. 1980]') === '1980');
assert('permalink BNP', catalogPermalink('656') === 'https://catalogo.bnportugal.gov.pt/ipac20/ipac.jsp?profile=bn&uri=full=3100024~!656~!0');
const bnpDc = parseOaiDc(BNP_OAI);
assert('OAI DC limpa marcadores', bnpDc?.title.includes('história no tempo de D. Afonso Henriques') && !bnpDc.title.includes('\u0098'));
assert('facto BNP', /Roussado Pinto/.test(buildFact(bnpDc.title, 'Roussado Pinto', '1980')) && /catálogo/.test(buildFact(bnpDc.title, 'Roussado Pinto', '1980')));
const bnpRecord = bnpToRecord(3, bnpDc, { words: ['Afonso Henriques'] });
assert('id facto BNP', bnpRecord?.knowledge_id === 'knw-cat3-bnp-656', bnpRecord?.knowledge_id);
assert('fonte Biblioteca Nacional', bnpRecord?.source === 'Biblioteca Nacional');
assert('resposta Afonso Henriques BNP', bnpRecord?.answer === 'Afonso Henriques', bnpRecord?.answer);
assert('V/F BNP', bnpToRecord(20, bnpDc).answer === 'Verdadeiro');
assert('BNP rejeita inglês e colóquio', bnpToRecord(3, parseOaiDc(BNP_OAI_EN), { words: [] }) === null);

async function fakeFetch(url) {
  if (String(url).includes('/tema/')) {
    return { ok: true, text: async () => RTP_RSS };
  }
  if (String(url).includes('ensina.rtp.pt/artigo/')) {
    return { ok: true, text: async () => RTP_HTML };
  }
  if (String(url).includes('imprensaregional.cienciaviva.pt')) {
    return { ok: true, text: async () => CV_RSS };
  }
  if (String(url).includes('wikipedia.org/w/api.php')) {
    return { ok: true, text: async () => ARQ_WIKI };
  }
  if (String(url).includes('arquivo.pt/wayback/cdx')) {
    return { ok: true, text: async () => ARQ_CDX };
  }
  if (String(url).includes('arquivo.pt/noFrame/replay')) {
    return { ok: true, text: async () => ARQ_HTML };
  }
  if (String(url).includes('catalogo.bnportugal.gov.pt')) {
    return { ok: true, text: async () => BNP_HTML };
  }
  if (String(url).includes('oai.bnportugal.gov.pt') && /catalogo(%2F|\/)656/i.test(String(url))) {
    return { ok: true, text: async () => BNP_OAI };
  }
  if (String(url).includes('oai.bnportugal.gov.pt')) {
    return { ok: true, text: async () => BNP_OAI_EN };
  }
  return { ok: false, status: 404, text: async () => '' };
}

(async () => {
  const rtp = await collectRtpRecords({ categoryN: 20, words: ['fitoplâncton'], limit: 10, fetchFn: fakeFetch });
  assert('colecta RTP com fetch falso', rtp.length === 1 && rtp[0].knowledge_id === 'knw-cat20-rtp-71359', JSON.stringify(rtp.map((r) => r.knowledge_id)));

  const cv = await collectCienciaVivaRecords({ categoryN: 20, words: ['oceano'], limit: 10, fetchFn: fakeFetch });
  assert('colecta Ciência Viva com fetch falso', cv.length === 1 && cv[0].knowledge_id === 'knw-cat20-cv-1604', JSON.stringify(cv.map((r) => r.knowledge_id)));

  const cvSkipHire = await collectCienciaVivaRecords({ categoryN: 20, words: [], limit: 10, fetchFn: fakeFetch });
  assert('CV ignora anúncio de emprego', cvSkipHire.every((row) => row.knowledge_id !== 'knw-cat20-cv-1'));
  assert('CV ignora comunicado PNAS', cvSkipHire.every((row) => row.knowledge_id !== 'knw-cat20-cv-1600'));

  const arq = await collectArquivoRecords({ categoryN: 3, words: ['Afonso'], limit: 10, fetchFn: fakeFetch });
  assert('colecta Arquivo.pt com fetch falso', arq.length === 1 && arq[0].knowledge_id === 'knw-cat3-arq-abcdef0123456789', JSON.stringify(arq.map((r) => r.knowledge_id)));
  assert('resposta Afonso Henriques', arq[0]?.answer === 'Afonso Henriques', arq[0]?.answer);
  assert('ignora desambiguação', arq.every((row) => !/desambigua/i.test(row.metadata?.title || '')));

  const bnp = await collectBnpRecords({ categoryN: 3, words: ['Afonso Henriques'], limit: 10, fetchFn: fakeFetch });
  assert('colecta BNP com fetch falso', bnp.length === 1 && bnp[0].knowledge_id === 'knw-cat3-bnp-656', JSON.stringify(bnp.map((r) => r.knowledge_id)));
  assert('resposta BNP Afonso Henriques', bnp[0]?.answer === 'Afonso Henriques', bnp[0]?.answer);
  assert('BNP ignora colóquio inglês', bnp.every((row) => row.knowledge_id !== 'knw-cat3-bnp-3882'));

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
