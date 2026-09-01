'use strict';

const batchData = require('./curiosidades-batch-50-data');

function buildStatement(fact) {
  const core = String(fact || '').trim().replace(/\.$/, '');
  return `${core}. Verdadeiro ou Falso?`;
}

function buildBatch50Records() {
  if (batchData.length !== 50) {
    throw new Error(`curiosidades-batch-50-data deve ter exactamente 50 entradas (tem ${batchData.length})`);
  }

  return batchData.map((item, index) => {
    const n = String(index + 1).padStart(3, '0');
    const priority = 65 + (index % 16);
    const confidence = 0.92 + (index % 8) * 0.01;

    return {
      knowledge_id: `knw-cat20-cur-b50-${n}`,
      category_n: 20,
      topic: 'curiosidade surpreendente',
      subtopic: item.subtopic,
      fact: item.fact,
      answer: item.answer,
      statement: buildStatement(item.fact),
      is_true: item.is_true,
      source: 'manual',
      source_id: `manual:curiosidade:b50-${n}`,
      confidence,
      priority_pt: priority,
      age_bands: item.age_bands,
      allowed_formats: ['CURIOSIDADE', 'VERDADEIRO_FALSO'],
      tags: item.tags,
    };
  });
}

module.exports = {
  buildStatement,
  buildBatch50Records,
};
