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
function extractTypeNames(raw: any): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((v: any) => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object' && v.name) return String(v.name)
      return ''
    }).filter(Boolean)
  }
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

// Classify investment type using all three signals: investment type string, action, and option type.
// This is used at both position level (approximate) and trade level (precise).
export function classifyInvestmentType(rawTypes: any, action?: string, optionType?: string): string {
  const types = extractTypeNames(rawTypes).map(t => t.toLowerCase())
  if (types.some(t => t.includes('crypto'))) return 'CRYPTO'
  if (types.some(t => t.includes('forex'))) return 'FOREX'
  if (types.some(t => t.includes('option'))) {
    const isSell = (action || '').toLowerCase() === 'sell'
    const opt = (optionType || '').toLowerCase()
    if (isSell && opt.includes('call')) return 'COVERED_CALL'
    if (isSell) return 'PUT_SELL'   // sell put or unspecified sell
    if (opt.includes('put')) return 'PUT'
    return 'CALL'
  }
  if (types.some(t => t.includes('stock') || t.includes('equity'))) return 'STOCK'
  return 'OTHER'
}
