/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const INCOME_TYPES = ['PUT_SELL', 'COVERED_CALL']
const DIRECTIONAL_TYPES = ['STOCK', 'CALL', 'PUT', 'SPREAD', 'CRYPTO', 'FOREX', 'OTHER']

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const pubCodes = searchParams.get('pubCodes')?.split(',').filter(Boolean) || []
  const gurus = searchParams.get('gurus')?.split(',').filter(Boolean) || []
  const types = searchParams.get('types')?.split(',').filter(Boolean) || []

  const baseWhere: any = {
    parentPositionId: null,
    status: 'Closed',
    positionReturn: { not: null },
    portfolio: { businessUnit: 'Monument Traders Alliance' },
  }

  if (pubCodes.length > 0) baseWhere.portfolio = { ...baseWhere.portfolio, pubCode: { in: pubCodes } }
  if (gurus.length > 0) {
    baseWhere.portfolio = {
      ...baseWhere.portfolio,
      gurus: { some: { guru: { slug: { in: gurus } } } },
    }
  }
  if (types.length > 0) baseWhere.investmentType = { in: types }

  const closed = await prisma.position.findMany({
    where: baseWhere,
    select: { positionReturn: true, investmentType: true, daysHeld: true },
  })

  const calc = (positions: typeof closed) => {
    const returns = positions.map(p => p.positionReturn!).filter(r => r !== null)
    if (returns.length === 0) return null
    const winners = returns.filter(r => r > 0)
    const losers = returns.filter(r => r <= 0)
    const avgDays = positions.map(p => p.daysHeld).filter(Boolean) as number[]
    return {
      total: returns.length,
      winners: winners.length,
      losers: losers.length,
      winRate: Math.round((winners.length / returns.length) * 1000) / 10,
      avgReturn: Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 1000) / 10,
      largestWinner: Math.round(Math.max(...returns) * 1000) / 10,
      largestLoser: Math.round(Math.min(...returns) * 1000) / 10,
      avgDaysHeld: avgDays.length ? Math.round(avgDays.reduce((a, b) => a + b, 0) / avgDays.length) : null,
    }
  }

  const directional = closed.filter(p => DIRECTIONAL_TYPES.includes(p.investmentType))
  const income = closed.filter(p => INCOME_TYPES.includes(p.investmentType))

  const openWhere: any = {
    parentPositionId: null,
    status: 'Open',
    portfolio: baseWhere.portfolio,
  }
  if (types.length > 0) openWhere.investmentType = { in: types }

  const openCount = await prisma.position.count({ where: openWhere })

  return NextResponse.json({
    directional: calc(directional),
    income: calc(income),
    openCount,
  })
}
