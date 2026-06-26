/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const pubCodes = searchParams.get('pubCodes')?.split(',').filter(Boolean) || []
  const gurus = searchParams.get('gurus')?.split(',').filter(Boolean) || []
  const types = searchParams.get('types')?.split(',').filter(Boolean) || []
  const status = searchParams.get('status') || 'all'
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
    where.portfolio = {
      ...where.portfolio,
      gurus: {
        some: { guru: { slug: { in: gurus } } },
      },
    }
  }

  if (types.length > 0) {
    where.investmentType = { in: types }
  }

  if (status === 'open') where.status = 'Open'
  else if (status === 'closed') where.status = 'Closed'

  const [total, positions] = await Promise.all([
    prisma.position.count({ where }),
    prisma.position.findMany({
      where,
      include: {
        portfolio: { include: { gurus: { include: { guru: true } } } },
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
