'use strict';

const batchData = require('./curiosidades-batch-50-b-data');

function buildStatement(fact) {
  const core = String(fact || '').trim().replace(/\.$/, '');
  return `${core}. Verdadeiro ou Falso?`;
}

function buildBatch50BRecords() {
  if (batchData.length !== 50) {
    throw new Error(`curiosidades-batch-50-b-data deve ter exactamente 50 entradas (tem ${batchData.length})`);
  }

  return batchData.map((item, index) => {
    const n = String(index + 1).padStart(3, '0');
    const priority = 62 + (index % 18);
    const confidence = 0.91 + (index % 9) * 0.01;

    return {
      knowledge_id: `knw-cat20-cur-b51-${n}`,
      category_n: 20,
      topic: 'curiosidade surpreendente',
      subtopic: item.subtopic,
      fact: item.fact,
      answer: item.answer,
      statement: buildStatement(item.fact),
      is_true: item.is_true,
      source: 'manual',
      source_id: `manual:curiosidade:b51-${n}`,
      confidence,
      priority_pt: priority,
      age_bands: item.age_bands,
      allowed_formats: ['CURIOSIDADE', 'VERDADEIRO_FALSO'],
      tags: item.tags,
    };
  });
}

module.exports = {
  buildBatch50BRecords,
};
