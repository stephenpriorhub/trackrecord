/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { airtableFetch, TABLES, classifyInvestmentType, detectSpreadType } from '@/lib/airtable'

const prisma = new PrismaClient()

// Airtable pub codes: MTA = War Room, PMR = Post Market Profits, TPU = Monument Trend Advisory
const PUB_CODES = ['TPU', 'MTA', 'PMR']

// How many positions to process against Postgres at once. The heavy work is DB writes,
// so a modest concurrency turns a ~10k-record sequential crawl into a job that finishes
// in the background window Railway allows. Kept conservative to avoid exhausting the
// Prisma connection pool.
const POSITION_CONCURRENCY = 8

const GURU_NAMES: Record<string, { slug: string; name: string }> = {
  'Bryan Bottarelli': { slug: 'bryan', name: 'Bryan Bottarelli' },
  'Karim Rahemtulla': { slug: 'karim', name: 'Karim Rahemtulla' },
  'Nate Bear': { slug: 'nate', name: 'Nate Bear' },
}

// Airtable's "Reporting Guru(s)" field (and the underlying editor fields) are wildly
// inconsistent across the three services: initials ('B', 'K'), first names ('Bryan'),
// full names ('Bryan Bottarelli'), plus stray casing/whitespace ('b', 'B '). Map any of
// those to a canonical slug so identical editors don't fragment into separate gurus.
const GURU_ALIASES: Record<string, string> = {
  b: 'bryan', bryan: 'bryan', 'bryan bottarelli': 'bryan', bottarelli: 'bryan',
  k: 'karim', karim: 'karim', 'karim rahemtulla': 'karim', rahemtulla: 'karim',
  n: 'nate', nate: 'nate', 'nate bear': 'nate', bear: 'nate',
}

function resolveGuruSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return GURU_ALIASES[raw.trim().toLowerCase()] || null
}

// Run an async mapper over items with a bounded number of concurrent workers.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// Ensure all known gurus exist once, up front, and return a slug -> db id map.
// Seeding before the concurrent position phase avoids racing upserts on the same slug.
async function ensureGurus(): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const info of Object.values(GURU_NAMES)) {
    const guru = await prisma.guru.upsert({
      where: { slug: info.slug },
      update: { name: info.name },
      create: { name: info.name, slug: info.slug },
    })
    map[info.slug] = guru.id
  }
  return map
}

// Extract the normalized guru slugs from a position's "Reporting Guru(s)" formula value.
// The field concatenates linked record names, so it may return
// "Bryan Bottarelli, Bryan Bottarelli" (comma-joined, possibly duplicated) as one string.
function reportingGuruSlugs(rawReportingGurus: any): string[] {
  const slugs = new Set<string>()
  if (!rawReportingGurus) return []
  const arr = Array.isArray(rawReportingGurus) ? rawReportingGurus : [rawReportingGurus]
  for (const v of arr) {
    const raw = typeof v === 'string' ? v : (v?.name ?? null)
    if (!raw) continue
    for (const part of String(raw).split(',')) {
      const slug = resolveGuruSlug(part)
      if (slug) slugs.add(slug)
    }
  }
  return [...slugs]
}

async function syncPub(pubCode: string) {
  const log = await prisma.syncLog.create({
    data: { pubCode, status: 'running' },
  })

  try {
    const guruIdBySlug = await ensureGurus()

    const portfolioRecords = await airtableFetch(TABLES.portfolios, {
      filterByFormula: `{Pub Code} = "${pubCode}"`,
    })

    if (!portfolioRecords.length) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', message: `No portfolio found for ${pubCode}`, completedAt: new Date() },
      })
      return { pubCode, status: 'error', message: 'Portfolio not found' }
    }

    const aPortfolio = portfolioRecords[0]
    const fields = aPortfolio.fields

    // Portfolio-level guru fallback, used when a position has no resolvable "Reporting Guru(s)".
    // Source of truth: brain vault publication descriptions (Resources/MTA Publication Descriptions.md).
    // Note: this base's Pub Code "PMR" = editorial code "PMK" = Post-Market Profits, a Bryan-only service.
    const pubGuruMap: Record<string, string[]> = {
      TPU: ['bryan', 'karim'], // Monument Trend Advisory — Karim & Bryan
      MTA: ['bryan', 'karim'], // The War Room — Bryan & Karim
      PMR: ['bryan'],          // Post-Market Profits — Bryan Bottarelli only
    }

    const guruDbIds = (pubGuruMap[pubCode] || [])
      .map(slug => guruIdBySlug[slug])
      .filter(Boolean)

    const portfolio = await prisma.portfolio.upsert({
      where: { airtableId: aPortfolio.id },
      update: {
        pubCode,
        name: fields['Portfolio Name'] || pubCode,
        businessUnit: fields['Business Unit']?.name || 'Monument Traders Alliance',
        status: fields['Portfolio Status']?.name || 'Open',
      },
      create: {
        airtableId: aPortfolio.id,
        pubCode,
        name: fields['Portfolio Name'] || pubCode,
        businessUnit: fields['Business Unit']?.name || 'Monument Traders Alliance',
        status: fields['Portfolio Status']?.name || 'Open',
      },
    })

    await prisma.portfolioGuru.deleteMany({ where: { portfolioId: portfolio.id } })
    for (const guruId of guruDbIds) {
      await prisma.portfolioGuru.upsert({
        where: { portfolioId_guruId: { portfolioId: portfolio.id, guruId } },
        update: {},
        create: { portfolioId: portfolio.id, guruId },
      })
    }

    const portfolioName = fields['Portfolio Name']
    if (!portfolioName) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', message: `Portfolio Name is blank for ${pubCode}`, completedAt: new Date() },
      })
      return { pubCode, status: 'error', message: 'Portfolio Name is blank' }
    }

    const positionRecords = await airtableFetch(TABLES.positions, {
      filterByFormula: `FIND("${portfolioName}", ARRAYJOIN({Portfolio Name (from Portfolio)}))`,
    })

    // Fetch ONLY this publication's trades, not the entire ~90k-row trades table. The old
    // code pulled every trade across all 13 publications on every run, which never finished.
    const tradeRecords = await airtableFetch(TABLES.trades, {
      filterByFormula: `FIND("${portfolioName}", ARRAYJOIN({Portfolio (from Parent Position)}))`,
    })
    const tradesByPositionId = new Map<string, any[]>()
    for (const trade of tradeRecords) {
      const parentLinks = trade.fields['Parent Position']
      const links = Array.isArray(parentLinks) ? parentLinks : []
      for (const link of links) {
        const linkId = typeof link === 'object' ? link.id : link
        if (linkId) {
          if (!tradesByPositionId.has(linkId)) tradesByPositionId.set(linkId, [])
          tradesByPositionId.get(linkId)!.push(trade)
        }
      }
    }

    async function syncPosition(aPos: any) {
      const pf = aPos.fields
      const investmentType = classifyInvestmentType(pf['Investment Type (from Associated Trades)'] || [])

      const posTradeRecords = tradesByPositionId.get(aPos.id) || []
      const posName = pf['Position Name'] || pf['Position Name (INTERNAL)'] || ''
      const spreadType = detectSpreadType(posName, posTradeRecords)

      const positionData = {
        name: posName,
        symbols: pf['Associated Symbols'] || [],
        status: pf['Open/Closed?'] || 'Open',
        investmentType,
        spreadType,
        positionReturn: pf['Position Return'] ?? null,
        openDate: pf['Open Date'] ? new Date(pf['Open Date']) : null,
        closeDate: pf['Close Date'] ? new Date(pf['Close Date']) : null,
        daysHeld: pf['Days Held'] ? Math.round(pf['Days Held']) : null,
      }

      const position = await prisma.position.upsert({
        where: { airtableId: aPos.id },
        update: positionData,
        create: { airtableId: aPos.id, portfolioId: portfolio.id, ...positionData },
      })

      // Sync PositionGuru records — prefer Reporting Guru(s), fall back to portfolio gurus.
      // Resolve every raw name through the alias map so 'B'/'Bryan'/'Bryan Bottarelli' all
      // collapse to one guru. Crucially, if a Reporting Guru value is present but resolves to
      // nothing (blank, typo, or a stray number), we STILL fall back to portfolio gurus — the
      // old code skipped the fallback whenever any value existed, leaving positions guru-less.
      const resolvedSlugs = reportingGuruSlugs(pf['Reporting Guru(s)'])
      const linkGuruIds = resolvedSlugs.map(s => guruIdBySlug[s]).filter(Boolean)
      const finalGuruIds = linkGuruIds.length > 0 ? linkGuruIds : guruDbIds

      await prisma.positionGuru.deleteMany({ where: { positionId: position.id } })
      for (const guruId of finalGuruIds) {
        await prisma.positionGuru.create({ data: { positionId: position.id, guruId } })
      }

      // Track trade-level types to back-fill position investmentType with full context
      const tradeTypes: string[] = []
      for (const aTrade of posTradeRecords) {
        const tf = aTrade.fields
        const action = tf['Action']?.name || tf['Action'] || ''
        const optionType = tf['Option Type']?.name || tf['Option Type'] || ''
        const toOpenOrClose = tf['To Open or Close']?.name || tf['To Open or Close'] || ''
        const tradeInvType = classifyInvestmentType(
          tf['Investment Type'] ? [tf['Investment Type']?.name || tf['Investment Type']] : [],
          action,
          optionType,
          toOpenOrClose
        )
        tradeTypes.push(tradeInvType)

        const tradeData = {
          name: tf['Trade Name'] || tf['Trade Name (INTERNAL)'] || '',
          symbol: tf['SYMBOL'] || '',
          action,
          toOpenOrClose,
          weight: tf['Weight'] ?? null,
          tradePrice: tf['Trade Price'] ?? null,
          tradeDate: tf['Trade Date'] ? new Date(tf['Trade Date']) : null,
          investmentType: tradeInvType,
          optionType: tf['Option Type']?.name || tf['Option Type'] || null,
          buyingPowerRequired: tf['Buying Power Required (Weighted)'] ?? null,
          marginRequirement: tf['Margin Requirement'] ?? null,
          latestPrice: tf['Latest Price'] ?? null,
          tradeReturn: tf['Trade Return'] ?? null,
        }

        await prisma.trade.upsert({
          where: { airtableId: aTrade.id },
          update: tradeData,
          create: { airtableId: aTrade.id, positionId: position.id, ...tradeData },
        })
      }

      // Back-fill position investmentType using trade-level precision
      // Priority: PUT_SELL/COVERED_CALL > CALL/PUT > STOCK > OTHER
      const INCOME = ['PUT_SELL', 'COVERED_CALL']
      const DIRECTIONAL_OPTIONS = ['CALL', 'PUT']
      let refinedType = investmentType
      if (tradeTypes.some(t => INCOME.includes(t))) {
        refinedType = tradeTypes.find(t => t === 'PUT_SELL') || tradeTypes.find(t => INCOME.includes(t)) || investmentType
      } else if (tradeTypes.some(t => DIRECTIONAL_OPTIONS.includes(t))) {
        refinedType = tradeTypes.find(t => DIRECTIONAL_OPTIONS.includes(t)) || investmentType
      } else if (tradeTypes.length > 0 && investmentType === 'OTHER') {
        refinedType = tradeTypes[0]
      }
      if (refinedType !== investmentType) {
        await prisma.position.update({
          where: { id: position.id },
          data: { investmentType: refinedType },
        })
      }
    }

    await mapLimit(positionRecords, POSITION_CONCURRENCY, syncPosition)
    const synced = positionRecords.length

    // Group partial closes: positions sharing name + open date collapse under one parent.
    const allPositions = await prisma.position.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { openDate: 'asc' },
    })

    const groups = new Map<string, typeof allPositions>()
    for (const pos of allPositions) {
      const key = `${pos.name}__${pos.openDate?.toISOString().split('T')[0]}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(pos)
    }

    const childUpdates: { childId: string; parentId: string }[] = []
    for (const group of groups.values()) {
      if (group.length > 1) {
        const [parent, ...children] = group
        for (const child of children) childUpdates.push({ childId: child.id, parentId: parent.id })
      }
    }
    await mapLimit(childUpdates, POSITION_CONCURRENCY, u =>
      prisma.position.update({ where: { id: u.childId }, data: { parentPositionId: u.parentId } })
    )

    await prisma.syncLog.update({
      where: { id: log.id },
      data: { portfolioId: portfolio.id, status: 'success', recordsSynced: synced, completedAt: new Date() },
    })
    return { pubCode, status: 'success', synced }
  } catch (err: any) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'error', message: err.message, completedAt: new Date() },
    })
    return { pubCode, status: 'error', message: err.message }
  }
}

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-sync-key') || req.nextUrl.searchParams.get('key')
  if (key !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const singlePub = req.nextUrl.searchParams.get('pubCode')
  const codesToSync = singlePub ? [singlePub.toUpperCase()] : PUB_CODES

  // Return 202 immediately; sync runs in background after response. Each pub fetches only
  // its own positions and trades, so the job stays small enough to complete.
  after(async () => {
    for (const pubCode of codesToSync) {
      await syncPub(pubCode)
    }
  })

  return NextResponse.json({ message: 'Sync started', pubCodes: codesToSync }, { status: 202 })
}
