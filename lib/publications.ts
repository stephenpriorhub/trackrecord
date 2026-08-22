// Publication identity — one place, so no Airtable-internal code ever reaches the UI.
//
// The Portfolio Tracker base (appnWWpR52p6T38EU) labels two of its three MTA portfolios
// with codes that are NOT the publications' real pub codes:
//
//   Airtable "MTA" -> WAR (The War Room)
//   Airtable "PMR" -> PMK (Post-Market Profits)
//   Airtable "TPU" -> TPU (Monument Trend Advisory)   [already correct]
//
// "MTA" is the business unit (Monument Traders Alliance), not a service. Only the sync
// layer may speak Airtable codes; Postgres, the APIs and the dashboard use the real ones.

/** Pub Code values as they appear in the Airtable Portfolio Tracker base. */
export const AIRTABLE_PUB_CODES = ['TPU', 'MTA', 'PMR', 'XAI'] as const

/** Airtable Pub Code -> the publication's real pub code. */
export const AIRTABLE_TO_PUB_CODE: Record<string, string> = {
  MTA: 'WAR',
  PMR: 'PMK',
  TPU: 'TPU',
  XAI: 'XAI',
}

export const PUB_NAMES: Record<string, string> = {
  WAR: 'The War Room',
  PMK: 'Post-Market Profits',
  TPU: 'Monument Trend Advisory',
  XAI: 'McCall Innovation Report',
}

/**
 * Accept a real pub code, an Airtable code, or a publication name and return the real
 * pub code. Keeps old /embed/MTA links and saved ?pubCodes=PMR URLs working.
 */
export function resolvePubCode(input: string): string {
  const c = input.trim().toUpperCase()
  return AIRTABLE_TO_PUB_CODE[c] ?? c
}

export function resolvePubCodes(inputs: string[]): string[] {
  return [...new Set(inputs.map(resolvePubCode))]
}

export function pubName(code: string): string {
  return PUB_NAMES[resolvePubCode(code)] ?? code
}

/** Dropdown/filter options, in the order they should be shown. */
export const PUB_OPTIONS = (['WAR', 'PMK', 'TPU', 'XAI'] as const).map(value => ({
  value,
  label: PUB_NAMES[value],
}))
