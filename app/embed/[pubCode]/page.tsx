/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ pubCode: string }>
  searchParams: Promise<{ guru?: string; type?: string; status?: string }>
}) {
  const { pubCode } = await params
  const sp = await searchParams
  const where: any = {
    parentPositionId: null,
    portfolio: { pubCode: pubCode.toUpperCase() },
  }
  if (sp.status === 'open') where.status = 'Open'
  else if (sp.status === 'closed') where.status = 'Closed'
  if (sp.type) where.investmentType = sp.type.toUpperCase()
  if (sp.guru) {
    where.portfolio = { ...where.portfolio, gurus: { some: { guru: { slug: sp.guru } } } }
  }

  const positions = await prisma.position.findMany({
    where,
    include: { portfolio: true },
    orderBy: { openDate: 'desc' },
    take: 100,
  })

  return (
    <div style={{ padding: '16px', fontSize: '13px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '12px', fontWeight: 700, fontSize: '16px', color: '#fff' }}>
        {pubCode.toUpperCase()} Track Record
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #374151', color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase' as const }}>
            <th style={{ textAlign: 'left' as const, padding: '6px 8px' }}>Position</th>
            <th style={{ textAlign: 'left' as const, padding: '6px 8px' }}>Symbol</th>
            <th style={{ textAlign: 'left' as const, padding: '6px 8px' }}>Opened</th>
            <th style={{ textAlign: 'left' as const, padding: '6px 8px' }}>Closed</th>
            <th style={{ textAlign: 'right' as const, padding: '6px 8px' }}>Return</th>
            <th style={{ textAlign: 'center' as const, padding: '6px 8px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos: any) => {
            const ret = pos.positionReturn
            const retStr = ret !== null ? `${ret * 100 >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}%` : '—'
            const retColor = ret !== null ? (ret >= 0 ? '#4ade80' : '#f87171') : '#9ca3af'
            return (
              <tr key={pos.id} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '8px', color: '#fff' }}>{pos.name}</td>
                <td style={{ padding: '8px', color: '#9ca3af', fontFamily: 'monospace', fontSize: '11px' }}>
                  {(pos.symbols || []).join(', ')}
                </td>
                <td style={{ padding: '8px', color: '#9ca3af' }}>
                  {pos.openDate ? new Date(pos.openDate).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '8px', color: '#9ca3af' }}>
                  {pos.closeDate ? new Date(pos.closeDate).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right' as const, fontWeight: 600, color: retColor }}>{retStr}</td>
                <td style={{ padding: '8px', textAlign: 'center' as const }}>
                  <span style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                    background: pos.status === 'Open' ? 'rgba(74,222,128,0.15)' : 'rgba(75,85,99,0.4)',
                    color: pos.status === 'Open' ? '#4ade80' : '#9ca3af',
                  }}>
                    {pos.status}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
