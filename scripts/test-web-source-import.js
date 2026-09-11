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

console.log('Colectores RTP e Ciência Viva — testes\n');

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

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
