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
  const status = searchParams.get('status') || 'all'
  const openStart = searchParams.get('openStart')
  const openEnd = searchParams.get('openEnd')
  const closeStart = searchParams.get('closeStart')
  const closeEnd = searchParams.get('closeEnd')
  const minReturn = searchParams.get('minReturn')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')

  const where: any = {
    parentPositionId: null,
    portfolio: {
      businessUnit: 'Monument Traders Alliance',
    },
  }

  if (pubCodes.length > 0) {
    where.portfolio = { ...where.portfolio, pubCode: { in: pubCodes } }
  }

  if (gurus.length > 0) {
    where.gurus = { some: { guru: { slug: { in: gurus } } } }
  }

  if (types.length > 0) {
    where.investmentType = { in: types }
  }

  if (spreadTypes.length > 0) {
    where.spreadType = { in: spreadTypes }
  }

  if (status === 'open') where.status = 'Open'
  else if (status === 'closed') where.status = 'Closed'

  // Opened-date range (inclusive). Date inputs arrive as YYYY-MM-DD; treat as UTC to match
  // how openDate/closeDate were stored on sync (new Date('YYYY-MM-DD') = UTC midnight).
  if (openStart) where.openDate = { ...(where.openDate || {}), gte: new Date(`${openStart}T00:00:00.000Z`) }
  if (openEnd) where.openDate = { ...(where.openDate || {}), lte: new Date(`${openEnd}T23:59:59.999Z`) }

  // Closed-date range (inclusive). Open positions have no closeDate, so setting this
  // naturally restricts results to closed trades in the window.
  if (closeStart) where.closeDate = { ...(where.closeDate || {}), gte: new Date(`${closeStart}T00:00:00.000Z`) }
  if (closeEnd) where.closeDate = { ...(where.closeDate || {}), lte: new Date(`${closeEnd}T23:59:59.999Z`) }

  // "Gain % over" — positionReturn is stored as a decimal (0.18 = 18%), so convert the
  // typed percentage. Applies to all positions (open unrealized + closed realized).
  const minReturnNum = minReturn !== null && minReturn !== '' ? parseFloat(minReturn) : NaN
  if (!Number.isNaN(minReturnNum)) where.positionReturn = { gte: minReturnNum / 100 }

  const [total, positions] = await Promise.all([
    prisma.position.count({ where }),
    prisma.position.findMany({
      where,
      include: {
        portfolio: { include: { gurus: { include: { guru: true } } } },
        gurus: { include: { guru: true } },
        trades: { orderBy: { tradeDate: 'asc' } },
        childPositions: {
          include: { trades: { orderBy: { tradeDate: 'asc' } } },
        },
      },
      orderBy: { openDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return NextResponse.json({ positions, total, page, limit })
}
