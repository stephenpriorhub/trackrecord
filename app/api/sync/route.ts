/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { airtableFetch, TABLES, classifyInvestmentType } from '@/lib/airtable'

const prisma = new PrismaClient()

const PUB_CODES = ['TPU', 'WAR', 'PMK']

const GURU_NAMES: Record<string, { slug: string; name: string }> = {
  'Bryan Bottarelli': { slug: 'bryan', name: 'Bryan Bottarelli' },
  'Karim Rahemtulla': { slug: 'karim', name: 'Karim Rahemtulla' },
  'Nate Bear': { slug: 'nate', name: 'Nate Bear' },
}

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-sync-key') || req.nextUrl.searchParams.get('key')
  if (key !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: any[] = []

  for (const pubCode of PUB_CODES) {
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
        results.push({ pubCode, status: 'error', message: 'Portfolio not found' })
        continue
      }

      const aPortfolio = portfolioRecords[0]
      const fields = aPortfolio.fields

      const pubGuruMap: Record<string, string[]> = {
        TPU: ['bryan', 'karim'],
        WAR: ['bryan', 'karim'],
        PMK: ['karim'],
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
      const positionRecords = await airtableFetch(TABLES.positions, {
        filterByFormula: `FIND("${portfolioName}", ARRAYJOIN({Portfolio Name (from Portfolio)}))`,
      })

      let synced = 0

      for (const aPos of positionRecords) {
        const pf = aPos.fields
        const rawInvestmentTypes = (pf['Investment Type (from Associated Trades)'] || [])
        const investmentType = classifyInvestmentType(rawInvestmentTypes)

        const position = await prisma.position.upsert({
          where: { airtableId: aPos.id },
          update: {
            name: pf['Position Name'] || pf['Position Name (INTERNAL)'] || '',
            symbols: pf['Associated Symbols'] || [],
            status: pf['Open/Closed?'] || 'Open',
            investmentType,
            positionReturn: pf['Position Return'] ?? null,
            openDate: pf['Open Date'] ? new Date(pf['Open Date']) : null,
            closeDate: pf['Close Date'] ? new Date(pf['Close Date']) : null,
            daysHeld: pf['Days Held'] ? Math.round(pf['Days Held']) : null,
          },
          create: {
            airtableId: aPos.id,
            portfolioId: portfolio.id,
            name: pf['Position Name'] || pf['Position Name (INTERNAL)'] || '',
            symbols: pf['Associated Symbols'] || [],
            status: pf['Open/Closed?'] || 'Open',
            investmentType,
            positionReturn: pf['Position Return'] ?? null,
            openDate: pf['Open Date'] ? new Date(pf['Open Date']) : null,
            closeDate: pf['Close Date'] ? new Date(pf['Close Date']) : null,
            daysHeld: pf['Days Held'] ? Math.round(pf['Days Held']) : null,
          },
        })
        synced++

        const tradeRecords = await airtableFetch(TABLES.trades, {
          filterByFormula: `FIND("${aPos.id}", ARRAYJOIN({Parent Position}))`,
        })

        for (const aTrade of tradeRecords) {
          const tf = aTrade.fields
          const action = tf['Action']?.name || tf['Action'] || ''
          const tradeInvType = classifyInvestmentType(
            tf['Investment Type'] ? [tf['Investment Type']?.name || tf['Investment Type']] : [],
            action
          )

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
      }

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
      results.push({ pubCode, status: 'success', synced })
    } catch (err: any) {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status: 'error', message: err.message, completedAt: new Date() },
      })
      results.push({ pubCode, status: 'error', message: err.message })
    }
  }

  return NextResponse.json({ results })
}
