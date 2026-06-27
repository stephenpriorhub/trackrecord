/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()


export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const pubCodes = searchParams.get('pubCodes')?.split(',').filter(Boolean) || []
  const gurus = searchParams.get('gurus')?.split(',').filter(Boolean) || []
  const types = searchParams.get('types')?.split(',').filter(Boolean) || []
  const spreadTypes = searchParams.get('spreadTypes')?.split(',').filter(Boolean) || []
  const statusFilter = searchParams.get('status') || 'all'

  const portfolioFilter: any = { businessUnit: 'Monument Traders Alliance' }
  if (pubCodes.length > 0) portfolioFilter.pubCode = { in: pubCodes }
  if (gurus.length > 0) portfolioFilter.gurus = { some: { guru: { slug: { in: gurus } } } }

  const closedWhere: any = {
    parentPositionId: null,
    status: 'Closed',
    portfolio: portfolioFilter,
  }
  if (types.length > 0) closedWhere.investmentType = { in: types }
  if (spreadTypes.length > 0) closedWhere.spreadType = { in: spreadTypes }

  // Fetch all closed positions including their trades (for weighted avg calculation)
  const closed = await prisma.position.findMany({
    where: closedWhere,
    select: {
      positionReturn: true,
      investmentType: true,
      daysHeld: true,
      trades: { select: { buyingPowerRequired: true } },
    },
  })

  function calc(positions: typeof closed) {
    if (positions.length === 0) return null

    const withReturn = positions.filter(p => p.positionReturn !== null)
    const noReturn = positions.filter(p => p.positionReturn === null)
    const returns = withReturn.map(p => p.positionReturn!)
    const winners = returns.filter(r => r > 0)
    const losers = returns.filter(r => r <= 0)
    const daysArr = withReturn.map(p => p.daysHeld).filter((d): d is number => d !== null)

    // Simple average return (pct, 1 decimal)
    const avgReturn = returns.length
      ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 1000) / 10
      : null

    // Buying-power weighted average return
    // For each position, sum trade-level buyingPowerRequired as position weight.
    // Falls back to equal weight (1) when BP data is unavailable.
    let weightedSum = 0
    let totalWeight = 0
    for (const p of withReturn) {
      const bp = p.trades.reduce((sum, t) => sum + (t.buyingPowerRequired ?? 0), 0)
      const weight = bp > 0 ? bp : 1
      weightedSum += p.positionReturn! * weight
      totalWeight += weight
    }
    const avgWeightedReturn = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 1000) / 10
      : null

    return {
      total: withReturn.length,
      unresolvedCount: noReturn.length,
      winners: winners.length,
      losers: losers.length,
      winRate: withReturn.length > 0
        ? Math.round((winners.length / withReturn.length) * 1000) / 10
        : 0,
      avgReturn,
      avgWeightedReturn,
      largestWinner: returns.length ? Math.round(Math.max(...returns) * 1000) / 10 : null,
      largestLoser: returns.length ? Math.round(Math.min(...returns) * 1000) / 10 : null,
      avgDaysHeld: daysArr.length
        ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length)
        : null,
    }
  }

  const openWhere: any = {
    parentPositionId: null,
    status: 'Open',
    portfolio: portfolioFilter,
  }
  if (types.length > 0) openWhere.investmentType = { in: types }
  if (spreadTypes.length > 0) openWhere.spreadType = { in: spreadTypes }
  const openCount = await prisma.position.count({ where: openWhere })

  // When filtering to open-only, closed stats are not relevant
  const summary = statusFilter === 'open' ? null : calc(closed)

  return NextResponse.json({
    summary,
    openCount,
  })
}
