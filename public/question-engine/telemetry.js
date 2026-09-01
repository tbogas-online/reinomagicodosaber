/**
 * Telemetria de geração de perguntas — Fase 3 (localStorage, sem chamadas externas).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'reino_magico_gen_telemetry_v1';
  const MAX_EVENTS = 200;

  function normalizeEvent(raw) {
    const e = raw && typeof raw === 'object' ? raw : {};
    return {
      ts: Number(e.ts) || Date.now(),
      outcome: String(e.outcome || 'unknown'),
      category: e.category != null ? Number(e.category) : null,
      formatId: e.formatId ? String(e.formatId) : '',
      ageBandKey: e.ageBandKey ? String(e.ageBandKey) : '',
      difficulty: e.difficulty != null ? Number(e.difficulty) : null,
      attempt: e.attempt != null ? Number(e.attempt) : null,
      issueCodes: Array.isArray(e.issueCodes) ? e.issueCodes.map(String) : [],
      provider: e.provider ? String(e.provider) : '',
      model: e.model ? String(e.model) : '',
      score: e.score != null ? Number(e.score) : null,
      source: e.source ? String(e.source) : 'ai',
    };
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
      mem.events.push(normalizeEvent(event));
      if (mem.events.length > MAX_EVENTS) {
        mem.events = mem.events.slice(-MAX_EVENTS);
      }
      save();
      return mem.events[mem.events.length - 1];
    }

    function getEvents() {
      return mem.events.slice();
    }

    function clear() {
      mem.events = [];
      save();
    }

    function getSummary() {
      const events = mem.events;
      const summary = {
        total: events.length,
        accepted: 0,
        rejected: 0,
        parseErrors: 0,
        apiErrors: 0,
        byIssueCode: {},
        byCategory: {},
        byFormat: {},
        rejectionRate: 0,
      };
      for (const ev of events) {
        if (ev.outcome === 'accepted') summary.accepted += 1;
        else if (ev.outcome === 'rejected') summary.rejected += 1;
        else if (ev.outcome === 'parse_error') summary.parseErrors += 1;
        else if (ev.outcome === 'api_error') summary.apiErrors += 1;

        for (const code of ev.issueCodes) {
          summary.byIssueCode[code] = (summary.byIssueCode[code] || 0) + 1;
        }
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
      }
      const failures = summary.rejected + summary.parseErrors + summary.apiErrors;
      summary.rejectionRate = summary.total ? failures / summary.total : 0;
      return summary;
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

  global.QuestionEngineTelemetry = Object.freeze({
    STORAGE_KEY,
    MAX_EVENTS,
    createStore,
    recordGenerationEvent,
    getTelemetrySummary,
    getTelemetryEvents,
    clearTelemetry,
    issueCodesFromDetails,
  });
})(typeof window !== 'undefined' ? window : globalThis);
