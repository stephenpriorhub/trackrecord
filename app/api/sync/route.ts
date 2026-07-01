/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { airtableFetch, TABLES, classifyInvestmentType, detectSpreadType } from '@/lib/airtable'

const prisma = new PrismaClient()

// Airtable pub codes: MTA = War Room, PMR = Post Market Profits
const PUB_CODES = ['TPU', 'MTA', 'PMR']

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

async function syncPub(pubCode: string, tradesByPositionId: Map<string, any[]>) {
  const log = await prisma.syncLog.create({
    data: { pubCode, status: 'running' },
  })

  try {
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

    const guruDbIds: string[] = []
    for (const slug of (pubGuruMap[pubCode] || [])) {
      const guruInfo = Object.values(GURU_NAMES).find(g => g.slug === slug)
      if (!guruInfo) continue
      const guru = await prisma.guru.upsert({
        where: { slug },
        update: { name: guruInfo.name },
        create: { name: guruInfo.name, slug },
      })
      guruDbIds.push(guru.id)
    }

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

    let synced = 0

    for (const aPos of positionRecords) {
      const pf = aPos.fields
      const rawInvestmentTypes = (pf['Investment Type (from Associated Trades)'] || [])
      const investmentType = classifyInvestmentType(rawInvestmentTypes)

      const tradeRecords = tradesByPositionId.get(aPos.id) || []
      const posName = pf['Position Name'] || pf['Position Name (INTERNAL)'] || ''
      const spreadType = detectSpreadType(posName, tradeRecords)

      // Resolve position-level guru from "Reporting Guru(s)" formula field.
      // The field is a formula that concatenates linked record names, so it may return
      // "Bryan Bottarelli, Bryan Bottarelli" (comma-joined, possibly duplicated) as one string.
      const rawReportingGurus = pf['Reporting Guru(s)']
      const reportingGuruNamesRaw: string[] = []
      if (rawReportingGurus) {
        const arr = Array.isArray(rawReportingGurus) ? rawReportingGurus : [rawReportingGurus]
        for (const v of arr) {
          const raw = typeof v === 'string' ? v : (v?.name ?? null)
          if (!raw) continue
          // Split on comma in case formula joined multiple names into one string
          for (const part of raw.split(',')) {
            const name = part.trim()
            if (name) reportingGuruNamesRaw.push(name)
          }
        }
      }
      // Deduplicate
      const reportingGuruNames = [...new Set(reportingGuruNamesRaw)]

      const position = await prisma.position.upsert({
        where: { airtableId: aPos.id },
        update: {
          name: posName,
          symbols: pf['Associated Symbols'] || [],
          status: pf['Open/Closed?'] || 'Open',
          investmentType,
          spreadType,
          positionReturn: pf['Position Return'] ?? null,
          openDate: pf['Open Date'] ? new Date(pf['Open Date']) : null,
          closeDate: pf['Close Date'] ? new Date(pf['Close Date']) : null,
          daysHeld: pf['Days Held'] ? Math.round(pf['Days Held']) : null,
        },
        create: {
          airtableId: aPos.id,
          portfolioId: portfolio.id,
          name: posName,
          symbols: pf['Associated Symbols'] || [],
          status: pf['Open/Closed?'] || 'Open',
          investmentType,
          spreadType,
          positionReturn: pf['Position Return'] ?? null,
          openDate: pf['Open Date'] ? new Date(pf['Open Date']) : null,
          closeDate: pf['Close Date'] ? new Date(pf['Close Date']) : null,
          daysHeld: pf['Days Held'] ? Math.round(pf['Days Held']) : null,
        },
      })

      // Sync PositionGuru records — prefer Reporting Guru(s), fall back to portfolio gurus.
      // Resolve every raw name through the alias map so 'B'/'Bryan'/'Bryan Bottarelli' all
      // collapse to one guru. Crucially, if a Reporting Guru value is present but resolves to
      // nothing (blank, typo, or a stray number), we STILL fall back to portfolio gurus — the
      // old code skipped the fallback whenever any value existed, leaving positions guru-less.
      await prisma.positionGuru.deleteMany({ where: { positionId: position.id } })

      const resolvedSlugs = new Set<string>()
      for (const guruName of reportingGuruNames) {
        const slug = resolveGuruSlug(guruName)
        if (slug) resolvedSlugs.add(slug)
      }

      let gurusLinked = 0
      for (const slug of resolvedSlugs) {
        const guruInfo = Object.values(GURU_NAMES).find(g => g.slug === slug)
        if (!guruInfo) continue
        // Ensure the guru row exists even if this pub's portfolio didn't seed it
        const guru = await prisma.guru.upsert({
          where: { slug },
          update: { name: guruInfo.name },
          create: { name: guruInfo.name, slug },
        })
        await prisma.positionGuru.create({ data: { positionId: position.id, guruId: guru.id } })
        gurusLinked++
      }

      if (gurusLinked === 0) {
        // Fall back to portfolio-level gurus
        for (const guruId of guruDbIds) {
          await prisma.positionGuru.create({ data: { positionId: position.id, guruId } })
        }
      }

      synced++

      // Track trade-level types to back-fill position investmentType with full context
      const tradeTypes: string[] = []

      for (const aTrade of tradeRecords) {
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

        await prisma.trade.upsert({
          where: { airtableId: aTrade.id },
          update: {
            name: tf['Trade Name'] || tf['Trade Name (INTERNAL)'] || '',
            symbol: tf['SYMBOL'] || '',
            action,
            toOpenOrClose: tf['To Open or Close']?.name || tf['To Open or Close'] || '',
            weight: tf['Weight'] ?? null,
            tradePrice: tf['Trade Price'] ?? null,
            tradeDate: tf['Trade Date'] ? new Date(tf['Trade Date']) : null,
            investmentType: tradeInvType,
            optionType: tf['Option Type']?.name || tf['Option Type'] || null,
            buyingPowerRequired: tf['Buying Power Required (Weighted)'] ?? null,
            marginRequirement: tf['Margin Requirement'] ?? null,
            latestPrice: tf['Latest Price'] ?? null,
            tradeReturn: tf['Trade Return'] ?? null,
          },
          create: {
            airtableId: aTrade.id,
            positionId: position.id,
            name: tf['Trade Name'] || tf['Trade Name (INTERNAL)'] || '',
            symbol: tf['SYMBOL'] || '',
            action,
            toOpenOrClose: tf['To Open or Close']?.name || tf['To Open or Close'] || '',
            weight: tf['Weight'] ?? null,
            tradePrice: tf['Trade Price'] ?? null,
            tradeDate: tf['Trade Date'] ? new Date(tf['Trade Date']) : null,
            investmentType: tradeInvType,
            optionType: tf['Option Type']?.name || tf['Option Type'] || null,
            buyingPowerRequired: tf['Buying Power Required (Weighted)'] ?? null,
            marginRequirement: tf['Margin Requirement'] ?? null,
            latestPrice: tf['Latest Price'] ?? null,
            tradeReturn: tf['Trade Return'] ?? null,
          },
        })
      }

      // Back-fill position investmentType using trade-level precision
      // Priority: PUT_SELL/COVERED_CALL > CALL/PUT > STOCK > OTHER
      const INCOME = ['PUT_SELL', 'COVERED_CALL']
      const DIRECTIONAL_OPTIONS = ['CALL', 'PUT']
      let refinedType = investmentType
      if (tradeTypes.some(t => INCOME.includes(t))) {
        // Use the first income type found (PUT_SELL takes precedence)
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

    // Group partial closes
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

    for (const group of groups.values()) {
      if (group.length > 1) {
        const [parent, ...children] = group
        for (const child of children) {
          await prisma.position.update({
            where: { id: child.id },
            data: { parentPositionId: parent.id },
          })
        }
      }
    }

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

  // Return 202 immediately; sync runs in background after response
  after(async () => {
    const allTradeRecords = await airtableFetch(TABLES.trades)
    const tradesByPositionId = new Map<string, any[]>()
    for (const trade of allTradeRecords) {
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
    for (const pubCode of codesToSync) {
      await syncPub(pubCode, tradesByPositionId)
    }
  })

  return NextResponse.json({ message: 'Sync started', pubCodes: codesToSync }, { status: 202 })
}
