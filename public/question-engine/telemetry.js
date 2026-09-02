/**
 * Telemetria de geração de perguntas — localStorage + sync servidor.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'reino_magico_gen_telemetry_v1';
  const MAX_EVENTS = 200;
  const SERVER_ENDPOINT = '/api/gen-telemetry';
  const VALID_GAME_MODES = new Set(['local', 'multiplayer', 'test']);

  const MAX_ISSUE_MESSAGES = 6;
  const MAX_ISSUE_MESSAGE_LEN = 200;
  const MAX_QUESTION_LEN = 500;
  const MAX_ANSWER_LEN = 200;
  const MAX_OPTION_LEN = 120;
  const MAX_OPTIONS = 6;

  function clipIssueMessage(value) {
    return String(value || '').trim().slice(0, MAX_ISSUE_MESSAGE_LEN);
  }

  function normalizeQuestionSnapshot(raw) {
    const src = raw?.questionSnapshot && typeof raw.questionSnapshot === 'object'
      ? raw.questionSnapshot
      : raw?.parsed && typeof raw.parsed === 'object'
        ? raw.parsed
        : null;
    if (!src) return null;
    const q = String(src.q || '').trim().slice(0, MAX_QUESTION_LEN);
    const a = String(src.a || '').trim().slice(0, MAX_ANSWER_LEN);
    const options = Array.isArray(src.options)
      ? src.options.map((o) => String(o || '').trim().slice(0, MAX_OPTION_LEN)).filter(Boolean).slice(0, MAX_OPTIONS)
      : [];
    if (!q && !a) return null;
    return { q, a, options };
  }

  function normalizeIssueMessages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => clipIssueMessage(m)).filter(Boolean).slice(0, MAX_ISSUE_MESSAGES);
  }

  function normalizeEvent(raw) {
    const e = raw && typeof raw === 'object' ? raw : {};
    const gameMode = VALID_GAME_MODES.has(String(e.gameMode)) ? String(e.gameMode) : 'local';
    const questionSnapshot = normalizeQuestionSnapshot(e);
    return {
      ts: Number(e.ts) || Date.now(),
      outcome: String(e.outcome || 'unknown'),
      category: e.category != null ? Number(e.category) : null,
      formatId: e.formatId ? String(e.formatId) : '',
      ageBandKey: e.ageBandKey ? String(e.ageBandKey) : '',
      difficulty: e.difficulty != null ? Number(e.difficulty) : null,
      attempt: e.attempt != null ? Number(e.attempt) : null,
      issueCodes: Array.isArray(e.issueCodes) ? e.issueCodes.map(String) : [],
      issueMessages: normalizeIssueMessages(e.issueMessages),
      provider: e.provider ? String(e.provider) : '',
      model: e.model ? String(e.model) : '',
      score: e.score != null ? Number(e.score) : null,
      source: e.source ? String(e.source) : 'ai',
      gameMode,
      questionSnapshot,
    };
  }

  function accumulateIssueDetail(summary, ev) {
    const codes = ev.issueCodes || [];
    const messages = ev.issueMessages || [];
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      const msg = messages[i] || messages[0] || '';
      if (!summary.byIssueDetail[code]) {
        summary.byIssueDetail[code] = { count: 0, sampleMessage: msg, lastOccurrence: null };
      }
      const entry = summary.byIssueDetail[code];
      entry.count += 1;
      if (msg && !entry.sampleMessage) {
        entry.sampleMessage = msg;
      }
      const occurrence = {
        ts: Number(ev.ts) || Date.now(),
        message: clipIssueMessage(msg),
        outcome: ev.outcome || '',
        source: ev.source ? String(ev.source) : 'ai',
        score: ev.score != null ? Number(ev.score) : null,
        category: ev.category != null ? Number(ev.category) : null,
        formatId: ev.formatId ? String(ev.formatId) : '',
        ageBandKey: ev.ageBandKey ? String(ev.ageBandKey) : '',
        gameMode: ev.gameMode || 'local',
        provider: ev.provider ? String(ev.provider) : '',
        model: ev.model ? String(ev.model) : '',
        difficulty: ev.difficulty != null ? Number(ev.difficulty) : null,
        attempt: ev.attempt != null ? Number(ev.attempt) : null,
        questionSnapshot: ev.questionSnapshot || null,
      };
      if (!entry.lastOccurrence || occurrence.ts >= entry.lastOccurrence.ts) {
        entry.lastOccurrence = occurrence;
      }
    }
  }

  function repoAcceptedCount(bySource) {
    return (bySource.repository?.accepted || 0)
      + (bySource['repo-direct']?.accepted || 0)
      + (bySource['repo-ai']?.accepted || 0);
  }

  function isNonAiDeliverySource(source) {
    const src = String(source || 'ai');
    return src !== 'ai' && src !== 'repo-ai';
  }

  function computeCat20Delivery(events) {
    const accepted = (events || []).filter(
      (ev) => ev.outcome === 'accepted' && Number(ev.category) === 20,
    );
    const total = accepted.length;
    const targetNonAiShare = 0.95;
    if (!total) {
      return {
        category: 20,
        accepted: 0,
        nonAi: 0,
        nonAiShare: 0,
        repository: 0,
        repositoryShare: 0,
        aiFree: 0,
        aiFreeShare: 0,
        meetsNonAiTarget: false,
        targetNonAiShare,
      };
    }
    let nonAi = 0;
    let repository = 0;
    let aiFree = 0;
    for (const ev of accepted) {
      const src = ev.source || 'ai';
      if (isNonAiDeliverySource(src)) nonAi += 1;
      if (src === 'repository' || src === 'repo-direct' || src === 'repo-ai') repository += 1;
      if (src === 'ai') aiFree += 1;
    }
    const nonAiShare = nonAi / total;
    return {
      category: 20,
      accepted: total,
      nonAi,
      nonAiShare,
      repository,
      repositoryShare: repository / total,
      aiFree,
      aiFreeShare: aiFree / total,
      meetsNonAiTarget: nonAiShare >= targetNonAiShare,
      targetNonAiShare,
    };
  }

  function computeSummary(events) {
    const summary = {
      total: events.length,
      accepted: 0,
      rejected: 0,
      parseErrors: 0,
      apiErrors: 0,
      byIssueCode: {},
      byIssueDetail: {},
      byCategory: {},
      byFormat: {},
      byGameMode: {},
      bySource: {},
      byProvider: {},
      byModel: {},
      byAttempt: {},
      rejectionRate: 0,
      acceptanceRate: 0,
      repositoryShare: 0,
      repoDirectShare: 0,
      bankShare: 0,
      nonAiShare: 0,
      aiAvgAttempts: null,
    };
    let aiAttemptSum = 0;
    let aiAttemptCount = 0;
    for (const ev of events) {
      if (ev.outcome === 'accepted') summary.accepted += 1;
      else if (ev.outcome === 'rejected') summary.rejected += 1;
      else if (ev.outcome === 'parse_error') summary.parseErrors += 1;
      else if (ev.outcome === 'api_error') summary.apiErrors += 1;

      for (const code of ev.issueCodes) {
        summary.byIssueCode[code] = (summary.byIssueCode[code] || 0) + 1;
      }
      accumulateIssueDetail(summary, ev);
      if (ev.category != null) {
        const ck = String(ev.category);
        if (!summary.byCategory[ck]) summary.byCategory[ck] = { total: 0, rejected: 0 };
        summary.byCategory[ck].total += 1;
        if (ev.outcome === 'rejected') summary.byCategory[ck].rejected += 1;
      }
      if (ev.formatId) {
        if (!summary.byFormat[ev.formatId]) summary.byFormat[ev.formatId] = { total: 0, rejected: 0 };
        summary.byFormat[ev.formatId].total += 1;
        if (ev.outcome === 'rejected') summary.byFormat[ev.formatId].rejected += 1;
      }
      const mode = ev.gameMode || 'local';
      if (!summary.byGameMode[mode]) summary.byGameMode[mode] = { total: 0, rejected: 0 };
      summary.byGameMode[mode].total += 1;
      if (ev.outcome === 'rejected' || ev.outcome === 'parse_error' || ev.outcome === 'api_error') {
        summary.byGameMode[mode].rejected += 1;
      }
      const src = ev.source || 'ai';
      if (!summary.bySource[src]) summary.bySource[src] = { total: 0, accepted: 0 };
      summary.bySource[src].total += 1;
      if (ev.outcome === 'accepted') summary.bySource[src].accepted += 1;
      if (ev.provider) {
        if (!summary.byProvider[ev.provider]) summary.byProvider[ev.provider] = { total: 0, accepted: 0, rejected: 0 };
        summary.byProvider[ev.provider].total += 1;
        if (ev.outcome === 'accepted') summary.byProvider[ev.provider].accepted += 1;
        else if (ev.outcome === 'rejected') summary.byProvider[ev.provider].rejected += 1;
      }
      if (ev.model) {
        if (!summary.byModel[ev.model]) summary.byModel[ev.model] = { total: 0, accepted: 0 };
        summary.byModel[ev.model].total += 1;
        if (ev.outcome === 'accepted') summary.byModel[ev.model].accepted += 1;
      }
      if (ev.outcome === 'accepted' && ev.attempt != null) {
        const key = String(Math.min(Math.max(Math.round(ev.attempt), 1), 10));
        summary.byAttempt[key] = (summary.byAttempt[key] || 0) + 1;
        if (ev.source === 'ai') {
          aiAttemptSum += ev.attempt;
          aiAttemptCount += 1;
        }
      }
    }
    const failures = summary.rejected + summary.parseErrors + summary.apiErrors;
    summary.rejectionRate = summary.total ? failures / summary.total : 0;
    summary.acceptanceRate = summary.total ? summary.accepted / summary.total : 0;
    const repoAccepted = repoAcceptedCount(summary.bySource);
    summary.repositoryShare = summary.accepted ? repoAccepted / summary.accepted : 0;
    const repoDirectAccepted = (summary.bySource['repo-direct']?.accepted || 0)
      + (summary.bySource.repository?.accepted || 0);
    summary.repoDirectShare = repoAccepted ? repoDirectAccepted / repoAccepted : 0;
    summary.bankShare = summary.accepted
      ? (summary.bySource.bank?.accepted || 0) / summary.accepted
      : 0;
    const nonAiAccepted = Object.entries(summary.bySource)
      .filter(([key]) => key !== 'ai' && key !== 'repo-ai')
      .reduce((sum, [, bucket]) => sum + (bucket.accepted || 0), 0);
    summary.nonAiShare = summary.accepted ? nonAiAccepted / summary.accepted : 0;
    summary.aiAvgAttempts = aiAttemptCount ? aiAttemptSum / aiAttemptCount : null;
    summary.cat20Delivery = computeCat20Delivery(events);
    return summary;
  }

  function syncEventToServer(event) {
    if (typeof fetch === 'undefined') return;
    try {
      fetch(SERVER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignora */ }
  }

  function createStore(storage) {
    const mem = { events: [] };

    function load() {
      try {
        const raw = storage?.getItem?.(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.events)) mem.events = parsed.events;
      } catch { /* ignora */ }
    }

    function save() {
      try {
        storage?.setItem?.(STORAGE_KEY, JSON.stringify({ events: mem.events }));
      } catch { /* quota */ }
    }

    function record(event) {
      const normalized = normalizeEvent(event);
      mem.events.push(normalized);
      if (mem.events.length > MAX_EVENTS) {
        mem.events = mem.events.slice(-MAX_EVENTS);
      }
      save();
      syncEventToServer(normalized);
      return normalized;
    }

    function getEvents() {
      return mem.events.slice();
    }

    function clear() {
      mem.events = [];
      save();
    }

    function getSummary() {
      return computeSummary(mem.events);
    }

    load();
    return { record, getEvents, getSummary, clear };
  }

  let defaultStore = null;

  function getDefaultStore() {
    if (!defaultStore) {
      const storage = (typeof localStorage !== 'undefined') ? localStorage : {
        getItem: () => null,
        setItem: () => {},
      };
      defaultStore = createStore(storage);
    }
    return defaultStore;
  }

  function recordGenerationEvent(event, store) {
    return (store || getDefaultStore()).record(event);
  }

  function getTelemetrySummary(store) {
    return (store || getDefaultStore()).getSummary();
  }

  function getTelemetryEvents(store) {
    return (store || getDefaultStore()).getEvents();
  }

  function clearTelemetry(store) {
    (store || getDefaultStore()).clear();
  }

  function issueCodesFromDetails(issueDetails) {
    return (issueDetails || [])
      .map((d) => (d && d.code) || null)
      .filter(Boolean);
  }

  function issueMessagesFromDetails(issueDetails) {
    return (issueDetails || [])
      .map((d) => (d && d.message) ? clipIssueMessage(d.message) : '')
      .filter(Boolean);
  }

  global.QuestionEngineTelemetry = Object.freeze({
    STORAGE_KEY,
    MAX_EVENTS,
    SERVER_ENDPOINT,
    createStore,
    normalizeEvent,
    normalizeQuestionSnapshot,
    computeSummary,
    recordGenerationEvent,
    getTelemetrySummary,
    getTelemetryEvents,
    clearTelemetry,
    issueCodesFromDetails,
    issueMessagesFromDetails,
    accumulateIssueDetail,
  });
})(typeof window !== 'undefined' ? window : globalThis);
