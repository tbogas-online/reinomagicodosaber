const {
  toLisbonDayKey,
  toLisbonHourKey,
  buildDailySeries,
  buildHourlySeries,
} = require('./lisbon-time');

function seriesToTv(points) {
  return (points || []).map((p) => ({ t: p.key, v: p.count || 0 }));
}

function sumTvSeries(series) {
  return (series || []).reduce((sum, point) => sum + (Number(point.v) || 0), 0);
}

function mergeTvSeries(seriesA, seriesB) {
  const map = new Map();
  for (const point of [...(seriesA || []), ...(seriesB || [])]) {
    map.set(point.t, (map.get(point.t) || 0) + (point.v || 0));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => ({ t, v }));
}

function accumulateReviewActionBuckets(targetDay, targetHour, isoTimestamp) {
  if (!isoTimestamp) return;
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return;
  const day = toLisbonDayKey(d);
  const hour = toLisbonHourKey(d);
  if (day) targetDay[day] = (targetDay[day] || 0) + 1;
  if (hour) targetHour[hour] = (targetHour[hour] || 0) + 1;
}

function buildReviewTimelineBucket(
  acceptedAsIsByHour,
  acceptedAsIsByDay,
  acceptedEditedByHour,
  acceptedEditedByDay,
  dismissedByHour,
  dismissedByDay,
  hours,
  days,
) {
  const acceptedAsIs = hours
    ? seriesToTv(buildHourlySeries(acceptedAsIsByHour, hours))
    : seriesToTv(buildDailySeries(acceptedAsIsByDay, days));
  const acceptedEdited = hours
    ? seriesToTv(buildHourlySeries(acceptedEditedByHour, hours))
    : seriesToTv(buildDailySeries(acceptedEditedByDay, days));
  const dismissed = hours
    ? seriesToTv(buildHourlySeries(dismissedByHour, hours))
    : seriesToTv(buildDailySeries(dismissedByDay, days));
  const totalAcceptedAsIs = sumTvSeries(acceptedAsIs);
  const totalAcceptedEdited = sumTvSeries(acceptedEdited);
  return {
    acceptedAsIs,
    acceptedEdited,
    accepted: mergeTvSeries(acceptedAsIs, acceptedEdited),
    dismissed,
    totalAcceptedAsIs,
    totalAcceptedEdited,
    totalAccepted: totalAcceptedAsIs + totalAcceptedEdited,
    totalDismissed: sumTvSeries(dismissed),
  };
}

function buildReviewActionsFromItems(items) {
  const actions = [];
  for (const ev of items || []) {
    const category = ev.category != null ? Number(ev.category) : null;
    const issueCodes = Array.isArray(ev.issueCodes) ? ev.issueCodes.filter(Boolean) : [];
    if (ev.bankValidatedAt) {
      const kind = ev.bankValidatedEdited === true
        ? 'edited'
        : (ev.bankValidatedEdited === false ? 'asIs' : 'accepted');
      actions.push({
        at: ev.bankValidatedAt,
        kind,
        category,
        issueCodes,
      });
    }
    if (ev.dismissedAt) {
      actions.push({
        at: ev.dismissedAt,
        kind: 'dismissed',
        category,
        issueCodes,
      });
    }
  }
  return actions;
}

function matchesReviewActionFilter(action, filter = {}) {
  const categoryRaw = filter.categoryN;
  const hasCategory = categoryRaw != null && categoryRaw !== '';
  const issueCode = String(filter.issueCode || '').trim();
  if (hasCategory && Number(action.category) !== Number(categoryRaw)) {
    return false;
  }
  if (issueCode && !(action.issueCodes || []).includes(issueCode)) {
    return false;
  }
  return true;
}

function computeReviewTimelineFromReviewActions(actions, filter = {}) {
  const acceptedAsIsByDay = {};
  const acceptedAsIsByHour = {};
  const acceptedEditedByDay = {};
  const acceptedEditedByHour = {};
  const dismissedByDay = {};
  const dismissedByHour = {};

  for (const action of actions || []) {
    if (!matchesReviewActionFilter(action, filter)) continue;
    if (action.kind === 'edited') {
      accumulateReviewActionBuckets(acceptedEditedByDay, acceptedEditedByHour, action.at);
    } else if (action.kind === 'asIs') {
      accumulateReviewActionBuckets(acceptedAsIsByDay, acceptedAsIsByHour, action.at);
    } else if (action.kind === 'dismissed') {
      accumulateReviewActionBuckets(dismissedByDay, dismissedByHour, action.at);
    }
  }

  return {
    '24h': buildReviewTimelineBucket(
      acceptedAsIsByHour, acceptedAsIsByDay, acceptedEditedByHour, acceptedEditedByDay,
      dismissedByHour, dismissedByDay, 24, null,
    ),
    '3d': buildReviewTimelineBucket(
      acceptedAsIsByHour, acceptedAsIsByDay, acceptedEditedByHour, acceptedEditedByDay,
      dismissedByHour, dismissedByDay, 72, null,
    ),
    '7d': buildReviewTimelineBucket(
      null, acceptedAsIsByDay, null, acceptedEditedByDay,
      null, dismissedByDay, null, 7,
    ),
    '14d': buildReviewTimelineBucket(
      null, acceptedAsIsByDay, null, acceptedEditedByDay,
      null, dismissedByDay, null, 14,
    ),
  };
}

function buildReviewTimelineFilterOptions(actions) {
  const categories = new Map();
  const issueCodes = new Map();
  for (const action of actions || []) {
    if (action.category != null && Number.isFinite(action.category)) {
      categories.set(action.category, (categories.get(action.category) || 0) + 1);
    }
    for (const code of action.issueCodes || []) {
      if (!code) continue;
      issueCodes.set(code, (issueCodes.get(code) || 0) + 1);
    }
  }
  return {
    categories: [...categories.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, count]) => ({ n, count })),
    issueCodes: [...issueCodes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, count })),
  };
}

function buildReviewTimelineFilterKeys(actions) {
  const keys = new Set();
  for (const action of actions || []) {
    const category = action.category != null && Number.isFinite(action.category)
      ? String(action.category)
      : '';
    const codes = action.issueCodes?.length ? action.issueCodes : [''];
    if (!category) continue;
    for (const code of codes) {
      keys.add(`${category}|${code}`);
    }
  }
  return keys;
}

function buildReviewTimelineBundles(items) {
  const reviewActions = buildReviewActionsFromItems(items);
  const reviewTimelineFilterOptions = buildReviewTimelineFilterOptions(reviewActions);
  const reviewTimeline = computeReviewTimelineFromReviewActions(reviewActions);
  const reviewTimelineByCategory = {};
  const reviewTimelineByIssueCode = {};
  const reviewTimelineByFilter = {};

  for (const { n } of reviewTimelineFilterOptions.categories) {
    reviewTimelineByCategory[String(n)] = computeReviewTimelineFromReviewActions(reviewActions, { categoryN: n });
  }
  for (const { code } of reviewTimelineFilterOptions.issueCodes) {
    reviewTimelineByIssueCode[code] = computeReviewTimelineFromReviewActions(reviewActions, { issueCode: code });
  }
  for (const key of buildReviewTimelineFilterKeys(reviewActions)) {
    const [categoryN, issueCode] = key.split('|');
    reviewTimelineByFilter[key] = computeReviewTimelineFromReviewActions(reviewActions, {
      categoryN: Number(categoryN),
      issueCode,
    });
  }

  return {
    reviewActions,
    reviewTimelineFilterOptions,
    reviewTimeline,
    reviewTimelineByCategory,
    reviewTimelineByIssueCode,
    reviewTimelineByFilter,
  };
}

function computeReviewTimelineFromItems(items) {
  return buildReviewTimelineBundles(items).reviewTimeline;
}

function resolveReviewTimelineBucket(summary, range, { categoryN = '', issueCode = '' } = {}) {
  const cat = String(categoryN ?? '').trim();
  const code = String(issueCode ?? '').trim();
  if (!cat && !code) return summary?.reviewTimeline?.[range] || null;
  if (cat && code) return summary?.reviewTimelineByFilter?.[`${cat}|${code}`]?.[range] || null;
  if (cat) return summary?.reviewTimelineByCategory?.[cat]?.[range] || null;
  return summary?.reviewTimelineByIssueCode?.[code]?.[range] || null;
}

module.exports = {
  buildReviewActionsFromItems,
  buildReviewTimelineFilterOptions,
  computeReviewTimelineFromReviewActions,
  computeReviewTimelineFromItems,
  buildReviewTimelineBundles,
  resolveReviewTimelineBucket,
  matchesReviewActionFilter,
};
