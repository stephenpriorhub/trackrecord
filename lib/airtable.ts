/* eslint-disable @typescript-eslint/no-explicit-any */
const AIRTABLE_BASE = process.env.AIRTABLE_PORTFOLIO_BASE!
const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY!

export const TABLES = {
  portfolios: 'tblf1pzaGmGlo81iW',
  positions: 'tbldV1JfYJoqZIoMk',
  trades: 'tblOdJSYE9OFowuTY',
}

export async function airtableFetch(table: string, params: Record<string, string> = {}) {
  const baseUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`
  const records: any[] = []
  let offset: string | undefined

  do {
    const url = new URL(baseUrl)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`Airtable ${table}: ${res.status} ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset
  } while (offset)

  return records
}

// Airtable multipleLookupValues returns either a flat string[] or a nested object
// with { linkedRecordIds, valuesByLinkedRecordId: { recXXX: [{id, name, color}][] } }
// This helper extracts the string names regardless of which shape is returned.
function extractTypeNames(raw: any): string[] {
  if (!raw) return []
  // Flat string array (e.g. from a direct singleSelect field)
  if (Array.isArray(raw)) {
    return raw.map((v: any) => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && v.name) return String(v.name)
      return ''
    }).filter(Boolean)
  }
  // multipleLookupValues nested object shape
  if (raw && typeof raw === 'object' && raw.valuesByLinkedRecordId) {
    const names: string[] = []
    for (const values of Object.values(raw.valuesByLinkedRecordId) as any[][]) {
      for (const v of values) {
        if (v && typeof v === 'object' && v.name) names.push(String(v.name))
        else if (typeof v === 'string') names.push(v)
      }
    }
    return names
  }
  return []
}

export function classifyInvestmentType(rawTypes: any, action?: string): string {
  const types = extractTypeNames(rawTypes).map(t => t.toLowerCase())
  if (types.some(t => t.includes('crypto'))) return 'CRYPTO'
  if (types.some(t => t.includes('forex'))) return 'FOREX'
  if (types.some(t => t.includes('option'))) {
    // Classify by option type and action
    const actionLower = (action || '').toLowerCase()
    if (actionLower === 'sell') return 'PUT_SELL'
    return 'CALL'
  }
  if (types.some(t => t.includes('stock') || t.includes('equity'))) return 'STOCK'
  return 'OTHER'
}
