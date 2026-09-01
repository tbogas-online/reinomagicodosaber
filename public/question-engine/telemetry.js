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

  function clipIssueMessage(value) {
    return String(value || '').trim().slice(0, MAX_ISSUE_MESSAGE_LEN);
  }

  function normalizeIssueMessages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => clipIssueMessage(m)).filter(Boolean).slice(0, MAX_ISSUE_MESSAGES);
  }

  function normalizeEvent(raw) {
    const e = raw && typeof raw === 'object' ? raw : {};
    const gameMode = VALID_GAME_MODES.has(String(e.gameMode)) ? String(e.gameMode) : 'local';
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
    };
  }

  function accumulateIssueDetail(summary, ev) {
    const codes = ev.issueCodes || [];
    const messages = ev.issueMessages || [];
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      const msg = messages[i] || messages[0] || '';
      if (!summary.byIssueDetail[code]) {
        summary.byIssueDetail[code] = { count: 0, sampleMessage: msg };
      }
      summary.byIssueDetail[code].count += 1;
      if (msg && !summary.byIssueDetail[code].sampleMessage) {
        summary.byIssueDetail[code].sampleMessage = msg;
      }
    }
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
      rejectionRate: 0,
      acceptanceRate: 0,
      repositoryShare: 0,
      nonAiShare: 0,
    };
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
    }
    const failures = summary.rejected + summary.parseErrors + summary.apiErrors;
    summary.rejectionRate = summary.total ? failures / summary.total : 0;
    summary.acceptanceRate = summary.total ? summary.accepted / summary.total : 0;
    const repoAccepted = summary.bySource.repository?.accepted || 0;
    summary.repositoryShare = summary.accepted ? repoAccepted / summary.accepted : 0;
    const nonAiAccepted = Object.entries(summary.bySource)
      .filter(([key]) => key !== 'ai')
      .reduce((sum, [, bucket]) => sum + (bucket.accepted || 0), 0);
    summary.nonAiShare = summary.accepted ? nonAiAccepted / summary.accepted : 0;
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
