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
  const openStart = searchParams.get('openStart')
  const openEnd = searchParams.get('openEnd')
  const closeStart = searchParams.get('closeStart')
  const closeEnd = searchParams.get('closeEnd')
  const minReturn = searchParams.get('minReturn')

  const portfolioFilter: any = { businessUnit: 'Monument Traders Alliance' }
  if (pubCodes.length > 0) portfolioFilter.pubCode = { in: pubCodes }
  const guruPositionFilter = gurus.length > 0
    ? { gurus: { some: { guru: { slug: { in: gurus } } } } }
    : {}

  // Date-range + gain filters, applied identically to positions API so the summary
  // matches the visible table. Dates are treated as UTC to match stored values.
  const openDateFilter: any = {}
  if (openStart) openDateFilter.gte = new Date(`${openStart}T00:00:00.000Z`)
  if (openEnd) openDateFilter.lte = new Date(`${openEnd}T23:59:59.999Z`)
  const closeDateFilter: any = {}
  if (closeStart) closeDateFilter.gte = new Date(`${closeStart}T00:00:00.000Z`)
  if (closeEnd) closeDateFilter.lte = new Date(`${closeEnd}T23:59:59.999Z`)
  const minReturnNum = minReturn !== null && minReturn !== '' ? parseFloat(minReturn) : NaN
  const hasOpenRange = Object.keys(openDateFilter).length > 0
  const hasCloseRange = Object.keys(closeDateFilter).length > 0
  const hasMinReturn = !Number.isNaN(minReturnNum)

  function applyExtraFilters(w: any) {
    if (hasOpenRange) w.openDate = openDateFilter
    if (hasCloseRange) w.closeDate = closeDateFilter
    if (hasMinReturn) w.positionReturn = { gte: minReturnNum / 100 }
  }

  const closedWhere: any = {
    parentPositionId: null,
    status: 'Closed',
    portfolio: portfolioFilter,
    ...guruPositionFilter,
  }
  if (types.length > 0) closedWhere.investmentType = { in: types }
  if (spreadTypes.length > 0) closedWhere.spreadType = { in: spreadTypes }
  applyExtraFilters(closedWhere)

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
    ...guruPositionFilter,
  }
  if (types.length > 0) openWhere.investmentType = { in: types }
  if (spreadTypes.length > 0) openWhere.spreadType = { in: spreadTypes }
  applyExtraFilters(openWhere)
  const openCount = await prisma.position.count({ where: openWhere })

  // When filtering to open-only, closed stats are not relevant
  const summary = statusFilter === 'open' ? null : calc(closed)

  return NextResponse.json({
    summary,
    openCount,
  })
}
