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

export function classifyInvestmentType(rawTypes: string[], action?: string): string {
  const types = (rawTypes || []).map(t => (t || '').toLowerCase())
  if (types.some(t => t.includes('crypto'))) return 'CRYPTO'
  if (types.some(t => t.includes('forex'))) return 'FOREX'
  if (types.some(t => t.includes('option'))) {
    if (action?.toLowerCase() === 'sell') return 'PUT_SELL'
    return 'CALL'
  }
  if (types.some(t => t.includes('stock') || t.includes('equity'))) return 'STOCK'
  return 'OTHER'
}
