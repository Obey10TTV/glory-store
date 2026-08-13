const REPORT_RULES = {
  unsafe_product: { priority: 'critical', triageMinutes: 60, resolutionHours: 24 },
  counterfeit: { priority: 'critical', triageMinutes: 60, resolutionHours: 24 },
  suspected_scam: { priority: 'high', triageMinutes: 240, resolutionHours: 72 },
  prohibited_item: { priority: 'high', triageMinutes: 240, resolutionHours: 72 },
  misleading_listing: { priority: 'standard', triageMinutes: 24 * 60, resolutionHours: 7 * 24 },
  stolen_content: { priority: 'standard', triageMinutes: 24 * 60, resolutionHours: 7 * 24 },
  other: { priority: 'standard', triageMinutes: 24 * 60, resolutionHours: 7 * 24 }
}

const getReportRule = (reason) => REPORT_RULES[reason] || REPORT_RULES.other

const scheduleReportReview = (reason, now = new Date()) => {
  const rule = getReportRule(reason)
  const startedAt = new Date(now)
  return {
    priority: rule.priority,
    triageDueAt: new Date(startedAt.getTime() + rule.triageMinutes * 60 * 1000),
    resolutionDueAt: new Date(startedAt.getTime() + rule.resolutionHours * 60 * 60 * 1000)
  }
}

const getReportSlaState = (report, now = new Date()) => {
  if (['actioned', 'dismissed'].includes(report.status)) return 'closed'
  if (report.resolutionDueAt && new Date(report.resolutionDueAt) <= now) return 'resolution_breached'
  if (!report.firstReviewedAt && report.triageDueAt && new Date(report.triageDueAt) <= now) return 'triage_breached'
  return 'on_track'
}

module.exports = {
  REPORT_RULES,
  getReportRule,
  getReportSlaState,
  scheduleReportReview
}
