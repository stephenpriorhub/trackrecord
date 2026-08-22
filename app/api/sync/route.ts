/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { airtableFetch, TABLES, classifyInvestmentType, detectSpreadType } from '@/lib/airtable'
import { AIRTABLE_PUB_CODES, AIRTABLE_TO_PUB_CODE, PUB_NAMES, resolvePubCode } from '@/lib/publications'
import warRoomOwners from '@/data/warRoomOwners.json'


// Verified War Room owner map, generated from the manually-maintained track-record
// workbook (every sheet's B/K column) by scripts/build-war-room-owners.py. All 8,846
// harvested rows carry exactly one owner and none of the 21 overlapping sheet cuts
// contradicts another — Bryan and Karim never co-own a War Room pick, which makes this
// workbook the authority on who made each one.
//   occ    — exact option contract: "TICKER|YYMMDD|C/P|STRIKE"   (2,366 keys, no conflicts)
//   dated  — underlying ticker + open date: "TICKER@YYYY-MM-DD"  (3,235 keys, no conflicts)
//   ticker — bare ticker, last owner to trade it                  (436 keys, ambiguous)
// Covers 96% of War Room positions (3,193 of 3,313); the rest are trades opened since the
// last export, which is why Airtable's Trade Guru stays in the chain below it.
const WAR_ROOM_OWNERS = warRoomOwners as {
  occ: Record<string, string>
  dated: Record<string, string>
  ticker: Record<string, string>
}

// Normalize an Airtable SYMBOL to the key format used in warRoomOwners.json:
// options -> "TICKER|YYMMDD|C/P|STRIKE" (strike as integer), otherwise the bare ticker.
function ownerKeyFromSymbol(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return null
  const m = s.match(/^([A-Z]+)(\d{6})([CP])(\d{6,8})/)
  if (m) return `${m[1]}|${m[2]}|${m[3]}|${parseInt(m[4], 10)}`
  return s
}

// Look a War Room position up in the verified workbook.
//
// `exact` matches an option contract or an underlying+open-date pair — both unambiguous,
// so they outrank Airtable. `loose` matches the bare ticker, which only records the LAST
// owner to trade that ticker; on multi-year LEAPS rolls it can name the wrong editor, so
// it sits BELOW Airtable's per-trade Trade Guru and is a last resort before the default.
function warRoomOwnerFor(
  symbols: string[],
  openDate: unknown,
  tier: 'exact' | 'loose',
): string | null {
  const keys = symbols.map(ownerKeyFromSymbol).filter((k): k is string => !!k)

  if (tier === 'loose') {
    for (const k of keys) {
      if (!k.includes('|') && WAR_ROOM_OWNERS.ticker[k]) return WAR_ROOM_OWNERS.ticker[k]
    }
    return null
  }

  for (const k of keys) {
    if (k.includes('|') && WAR_ROOM_OWNERS.occ[k]) return WAR_ROOM_OWNERS.occ[k]
  }
  const day = openDate instanceof Date && !isNaN(openDate.getTime())
    ? openDate.toISOString().slice(0, 10)
    : null
  if (day) {
    for (const k of keys) {
      // `dated` is keyed by the underlying ticker, so an option key matches on its root.
      const owner = WAR_ROOM_OWNERS.dated[`${k.split('|')[0]}@${day}`]
      if (owner) return owner
    }
  }
  return null
}

// How many positions to process against Postgres at once. The heavy work is DB writes,
// so a modest concurrency turns a ~10k-record sequential crawl into a job that finishes
// in the background window Railway allows. Kept conservative to avoid exhausting the
// Prisma connection pool.
const POSITION_CONCURRENCY = 8

const GURU_NAMES: Record<string, { slug: string; name: string }> = {
  'Bryan Bottarelli': { slug: 'bryan', name: 'Bryan Bottarelli' },
  'Karim Rahemtulla': { slug: 'karim', name: 'Karim Rahemtulla' },
  'Nate Bear': { slug: 'nate', name: 'Nate Bear' },
  'George': { slug: 'george', name: 'George' },
  'Matt McCall': { slug: 'matt', name: 'Matt McCall' },
}

// War Room is single-owner per position: Bryan and Karim never co-own a pick, so a WAR or
// PMK position resolves to exactly one guru and never to a Bryan+Karim pair. Trend Advisory
// (TPU) is still co-managed here — pending a verified TPU owner sheet, a position with no
// per-trade owner falls back to both editors.
const SINGLE_OWNER_PUBS = new Set(['WAR', 'PMK'])

// Airtable's "Reporting Guru(s)" field (and the underlying editor fields) are wildly
// inconsistent across the three services: initials ('B', 'K'), first names ('Bryan'),
// full names ('Bryan Bottarelli'), plus stray casing/whitespace ('b', 'B '). Map any of
// those to a canonical slug so identical editors don't fragment into separate gurus.
const GURU_ALIASES: Record<string, string> = {
  b: 'bryan', bryan: 'bryan', 'bryan bottarelli': 'bryan', bottarelli: 'bryan',
  k: 'karim', karim: 'karim', 'karim rahemtulla': 'karim', rahemtulla: 'karim',
  n: 'nate', nate: 'nate', 'nate bear': 'nate', bear: 'nate',
  george: 'george', // War Room analyst tracked as his own guru (distinct from "Neil George")
  m: 'matt', matt: 'matt', 'matt mccall': 'matt', mccall: 'matt',
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

// `airtableCode` is the Pub Code as stored in Airtable ('MTA', 'PMR', 'TPU'); `pubCode` is
// the publication's real code ('WAR', 'PMK', 'TPU') and is what gets written to Postgres.
async function syncPub(airtableCode: string) {
  const pubCode = AIRTABLE_TO_PUB_CODE[airtableCode] ?? airtableCode
  const log = await prisma.syncLog.create({
    data: { pubCode, status: 'running' },
  })

  try {
    const guruIdBySlug = await ensureGurus()

    const portfolioRecords = await airtableFetch(TABLES.portfolios, {
      filterByFormula: `{Pub Code} = "${airtableCode}"`,
    })

    if (!portfolioRecords.length) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', message: `No portfolio found for ${pubCode}`, completedAt: new Date() },
      })
      return { pubCode, status: 'error', message: 'Portfolio not found' }
    }

    // A publication can own more than one portfolio under a single Pub Code: XAI covers
    // both "The McCall Letter" and the "Disruptor 25 Portfolio". Sync every match, not
    // just the first — each becomes its own Portfolio row sharing the publication's code.
    const skipped: string[] = []

    async function syncOnePortfolio(aPortfolio: any) {
      const fields = aPortfolio.fields

      // Portfolio-level editor list. Source of truth: brain vault publication descriptions
      // (Resources/MTA Publication Descriptions.md). This describes who runs the service —
      // it is NOT per-position attribution, which is resolved per position below.
      const pubGuruMap: Record<string, string[]> = {
        TPU: ['bryan', 'karim'], // Monument Trend Advisory — Karim & Bryan
        WAR: ['bryan', 'karim'], // The War Room — Bryan & Karim (each pick owned by one of them)
        PMK: ['bryan'],          // Post-Market Profits — Bryan Bottarelli only
        XAI: ['matt'],           // McCall Innovation Report — Matt McCall only
      }

      const guruDbIds = (pubGuruMap[pubCode] || [])
        .map(slug => guruIdBySlug[slug])
        .filter(Boolean)

      // Name: prefer the publication's real name over Airtable's "Portfolio Name", which
      // carries the same mislabelling as the Pub Code (e.g. "MTA War Room"). Exception —
      // when a pub owns several portfolios (XAI), keep Airtable's names so the individual
      // books ("The McCall Letter", "Disruptor 25 Portfolio") stay distinguishable.
      const portfolioData = {
        pubCode,
        name: (portfolioRecords.length > 1
          ? fields['Portfolio Name']
          : PUB_NAMES[pubCode]) || fields['Portfolio Name'] || pubCode,
        businessUnit: fields['Business Unit']?.name || 'Monument Traders Alliance',
        status: fields['Portfolio Status']?.name || 'Open',
      }

      const portfolio = await prisma.portfolio.upsert({
        where: { airtableId: aPortfolio.id },
        update: portfolioData,
        create: { airtableId: aPortfolio.id, ...portfolioData },
      })

      await prisma.portfolioGuru.deleteMany({ where: { portfolioId: portfolio.id } })
      for (const guruId of guruDbIds) {
        await prisma.portfolioGuru.upsert({
          where: { portfolioId_guruId: { portfolioId: portfolio.id, guruId } },
          update: {},
          create: { portfolioId: portfolio.id, guruId },
        })
      }

      // Positions are located by Airtable's Portfolio Name, so a blank one leaves this
      // portfolio unsyncable. Skip it and note it on the pub's sync log rather than
      // failing the whole publication — its sibling portfolios are still fine.
      const portfolioName = fields['Portfolio Name']
      if (!portfolioName) {
        skipped.push(aPortfolio.id)
        return null
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

        // Attribute the position to exactly ONE guru for single-owner pubs. Bryan and Karim
        // never make a joint pick, so these must never resolve to a Bryan+Karim pair.
        //
        // War Room order of authority:
        //   1. an unambiguous match in the verified workbook (data/warRoomOwners.json) — the
        //      published record editorial maintains by hand, with an explicit B/K per row;
        //   2. Airtable's per-trade "Trade Guru", for positions opened since the last export;
        //   3. a bare-ticker match in the workbook (see warRoomOwnerFor);
        //   4. Bryan, the primary editor.
        // Do NOT use the position-level "Reporting Guru(s)" formula here: it defaults to the
        // portfolio's two editors and so reports "Bryan, Karim" for any unattributed position.
        let finalGuruIds: string[]
        if (SINGLE_OWNER_PUBS.has(pubCode)) {
          // Plurality owner across the position's trades; ties break to the opening trade.
          const counts = new Map<string, number>()
          const firstDate = new Map<string, number>()
          for (const aTrade of posTradeRecords) {
            const tg = aTrade.fields['Trade Guru']
            const links = Array.isArray(tg) ? tg : (tg ? [tg] : [])
            const td = aTrade.fields['Trade Date'] ? Date.parse(aTrade.fields['Trade Date']) : Number.MAX_SAFE_INTEGER
            const seen = new Set<string>()
            for (const link of links) {
              const slug = resolveGuruSlug(typeof link === 'string' ? link : link?.name)
              if (!slug || seen.has(slug)) continue
              seen.add(slug)
              counts.set(slug, (counts.get(slug) || 0) + 1)
              if (!firstDate.has(slug) || td < firstDate.get(slug)!) firstDate.set(slug, td)
            }
          }
          const owners = [...counts.keys()]
          owners.sort((a, b) => (counts.get(b)! - counts.get(a)!) || (firstDate.get(a)! - firstDate.get(b)!))

          const symbols: string[] = pubCode === 'WAR'
            ? [
                ...(Array.isArray(positionData.symbols) ? positionData.symbols : []),
                ...posTradeRecords.map((t: any) => t.fields['SYMBOL']).filter(Boolean),
              ]
            : []
          const ownerSlug =
            (symbols.length ? warRoomOwnerFor(symbols, positionData.openDate, 'exact') : null)
            ?? owners[0]
            ?? (symbols.length ? warRoomOwnerFor(symbols, positionData.openDate, 'loose') : null)
            ?? 'bryan'
          finalGuruIds = [guruIdBySlug[ownerSlug]].filter(Boolean)
        } else {
          const resolvedSlugs = reportingGuruSlugs(pf['Reporting Guru(s)'])
          const linkGuruIds = resolvedSlugs.map(s => guruIdBySlug[s]).filter(Boolean)
          finalGuruIds = linkGuruIds.length > 0 ? linkGuruIds : guruDbIds
        }

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

      return { portfolioId: portfolio.id, synced: positionRecords.length }
    }

    const results: { portfolioId: string; synced: number }[] = []
    for (const aPortfolio of portfolioRecords) {
      const r = await syncOnePortfolio(aPortfolio)
      if (r) results.push(r)
    }
    const synced = results.reduce((n, r) => n + r.synced, 0)

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        // A pub with several portfolios logs against the first; recordsSynced covers all.
        portfolioId: results[0]?.portfolioId ?? null,
        status: 'success',
        recordsSynced: synced,
        message: skipped.length ? `Skipped (blank Portfolio Name): ${skipped.join(', ')}` : null,
        completedAt: new Date(),
      },
    })
    return { pubCode, status: 'success', synced, portfolios: results.length }
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

  // ?pubCode= accepts either a real code (WAR/PMK/TPU) or an Airtable code (MTA/PMR/TPU);
  // syncPub queries Airtable, so translate back to the Airtable code here.
  const singlePub = req.nextUrl.searchParams.get('pubCode')
  const toAirtableCode = (c: string) => {
    const real = resolvePubCode(c)
    return AIRTABLE_PUB_CODES.find(a => AIRTABLE_TO_PUB_CODE[a] === real) ?? c.toUpperCase()
  }
  const codesToSync = singlePub ? [toAirtableCode(singlePub)] : [...AIRTABLE_PUB_CODES]

  // Return 202 immediately; sync runs in background after response. Each pub fetches only
  // its own positions and trades, so the job stays small enough to complete.
  after(async () => {
    for (const airtableCode of codesToSync) {
      await syncPub(airtableCode)
    }
  })

  return NextResponse.json(
    { message: 'Sync started', pubCodes: codesToSync.map(c => AIRTABLE_TO_PUB_CODE[c] ?? c) },
    { status: 202 },
  )
}
