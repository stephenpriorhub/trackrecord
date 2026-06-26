'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback } from 'react'

const PUB_OPTIONS = [
  { value: 'TPU', label: 'Monument Trend Advisory' },
  { value: 'MTA', label: 'MTA War Room' },
  { value: 'PMR', label: 'Post Market Profits' },
]

const GURU_OPTIONS = [
  { value: 'bryan', label: 'Bryan Bottarelli' },
  { value: 'karim', label: 'Karim Rahemtulla' },
  { value: 'nate', label: 'Nate Bear' },
]

const TYPE_OPTIONS = [
  { value: 'STOCK', label: 'Stock' },
  { value: 'CALL', label: 'Call Options' },
  { value: 'PUT', label: 'Put Options' },
  { value: 'PUT_SELL', label: 'Put Sell (Income)' },
  { value: 'COVERED_CALL', label: 'Covered Call (Income)' },
  { value: 'SPREAD', label: 'Spread' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'OTHER', label: 'Other' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

function returnColor(r: number | null | undefined) {
  if (r === null || r === undefined) return 'text-gray-400'
  const val = Math.abs(r) < 10 ? r * 100 : r
  return val >= 0 ? 'text-green-400' : 'text-red-400'
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  )
}

function StatsCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

export default function TrackRecordDashboard() {
  const [pubCodes, setPubCodes] = useState<string[]>([])
  const [gurus, setGurus] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [status, setStatus] = useState('all')
  const [positions, setPositions] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedPosition, setSelectedPosition] = useState<any>(null)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    if (pubCodes.length) p.set('pubCodes', pubCodes.join(','))
    if (gurus.length) p.set('gurus', gurus.join(','))
    if (types.length) p.set('types', types.join(','))
    if (status !== 'all') p.set('status', status)
    return p.toString()
  }, [pubCodes, gurus, types, status])

  useEffect(() => {
    setLoading(true)
    const params = buildParams()
    Promise.all([
      fetch(`/api/positions?${params}&page=${page}&limit=50`).then(r => r.json()),
      fetch(`/api/stats?${params}`).then(r => r.json()),
    ]).then(([posData, statsData]) => {
      setPositions(posData.positions || [])
      setTotal(posData.total || 0)
      setStats(statsData)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [buildParams, page])

  useEffect(() => { setPage(1) }, [pubCodes, gurus, types, status])

  function toggle(arr: string[], val: string, set: (v: string[]) => void) {
    set(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
  }

  const d = stats?.directional
  const inc = stats?.income

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">MTA Track Record</h1>
          <p className="text-gray-400 mt-1">Monument Traders Alliance — Live portfolio performance</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 space-y-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Publication</div>
            <div className="flex flex-wrap gap-2">
              {PUB_OPTIONS.map(o => (
                <FilterPill key={o.value} label={o.label} active={pubCodes.includes(o.value)}
                  onClick={() => toggle(pubCodes, o.value, setPubCodes)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Guru</div>
            <div className="flex flex-wrap gap-2">
              {GURU_OPTIONS.map(o => (
                <FilterPill key={o.value} label={o.label} active={gurus.includes(o.value)}
                  onClick={() => toggle(gurus, o.value, setGurus)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Strategy</div>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map(o => (
                <FilterPill key={o.value} label={o.label} active={types.includes(o.value)}
                  onClick={() => toggle(types, o.value, setTypes)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map(o => (
                <FilterPill key={o.value} label={o.label} active={status === o.value}
                  onClick={() => setStatus(o.value)} />
              ))}
            </div>
          </div>
        </div>

        {d && (
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Directional Trades</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <StatsCard label="Total Closed" value={d.total.toLocaleString()} />
              <StatsCard label="Win Rate" value={`${d.winRate}%`} sub={`${d.winners}W / ${d.losers}L`} />
              <StatsCard label="Avg Return" value={`${d.avgReturn > 0 ? '+' : ''}${d.avgReturn}%`} />
              <StatsCard label="Largest Win" value={`+${d.largestWinner}%`} />
              <StatsCard label="Largest Loss" value={`${d.largestLoser}%`} />
              <StatsCard label="Avg Days Held" value={d.avgDaysHeld ? `${d.avgDaysHeld}d` : '—'} />
            </div>
          </div>
        )}
        {inc && inc.total > 0 && (
          <div className="mb-6">
            <div className="text-xs text-yellow-600 uppercase tracking-wide mb-3">Income Strategies (Put-Sell / Covered Calls) — Return on Buying Power</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              <StatsCard label="Total Closed" value={inc.total.toLocaleString()} />
              <StatsCard label="Win Rate" value={`${inc.winRate}%`} sub={`${inc.winners}W / ${inc.losers}L`} />
              <StatsCard label="Avg Return on BP" value={`${inc.avgReturn > 0 ? '+' : ''}${inc.avgReturn}%`} />
              <StatsCard label="Largest Win" value={`+${inc.largestWinner}%`} />
              <StatsCard label="Largest Loss" value={`${inc.largestLoser}%`} />
            </div>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex justify-between items-center px-5 py-4 border-b border-gray-800">
            <span className="text-sm text-gray-400">{total.toLocaleString()} positions</span>
            {stats?.openCount > 0 && (
              <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-1 rounded-full">
                {stats.openCount} open
              </span>
            )}
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-500">Loading...</div>
          ) : positions.length === 0 ? (
            <div className="text-center py-16 text-gray-500">No positions match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                    <th className="text-left px-5 py-3">Position</th>
                    <th className="text-left px-4 py-3">Symbol</th>
                    <th className="text-left px-4 py-3">Pub</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">Opened</th>
                    <th className="text-left px-4 py-3">Closed</th>
                    <th className="text-right px-4 py-3">Days</th>
                    <th className="text-right px-5 py-3">Return</th>
                    <th className="text-center px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos: any) => (
                    <tr
                      key={pos.id}
                      onClick={() => setSelectedPosition(pos)}
                      className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-white">{pos.name || '—'}</div>
                        {pos.childPositions?.length > 0 && (
                          <div className="text-xs text-yellow-600 mt-0.5">
                            Partial close ({pos.childPositions.length + 1} tranches)
                          </div>
                        )}
                        {pos.portfolio?.gurus?.length > 0 && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {pos.portfolio.gurus.map((g: any) => g.guru.name).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                        {(pos.symbols || []).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">
                          {pos.portfolio?.pubCode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{pos.investmentType}</td>
                      <td className="px-4 py-3 text-gray-400">
                        {pos.openDate ? new Date(pos.openDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {pos.closeDate ? new Date(pos.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{pos.daysHeld ?? '—'}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${returnColor(pos.positionReturn)}`}>
                        {pos.positionReturn !== null
                          ? `${pos.positionReturn * 100 >= 0 ? '+' : ''}${(pos.positionReturn * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          pos.status === 'Open'
                            ? 'bg-green-900/40 text-green-400'
                            : 'bg-gray-800 text-gray-400'
                        }`}>
                          {pos.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 50 && (
            <div className="flex justify-between items-center px-5 py-4 border-t border-gray-800">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm bg-gray-800 rounded-lg disabled:opacity-40 hover:bg-gray-700"
              >
                Previous
              </button>
              <span className="text-sm text-gray-400">
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(total / 50)}
                className="px-4 py-2 text-sm bg-gray-800 rounded-lg disabled:opacity-40 hover:bg-gray-700"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedPosition && (
        <DrillDownModal position={selectedPosition} onClose={() => setSelectedPosition(null)} />
      )}
    </div>
  )
}

function DrillDownModal({ position, onClose }: { position: any; onClose: () => void }) {
  const allTranches = [position, ...(position.childPositions || [])]
  const isPartialClose = position.childPositions?.length > 0

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start p-6 border-b border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-white">{position.name}</h2>
            <div className="text-sm text-gray-400 mt-1">
              {(position.symbols || []).join(', ')} · {position.portfolio?.pubCode} · {position.investmentType}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-6">
          {isPartialClose && (
            <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-3 text-sm text-yellow-400">
              This position has {allTranches.length} tranches (partial closes)
            </div>
          )}

          {allTranches.map((tranche: any, ti: number) => (
            <div key={tranche.id}>
              {isPartialClose && (
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                  Tranche {ti + 1}{' '}
                  {tranche.status === 'Closed'
                    ? `— Closed ${tranche.closeDate ? new Date(tranche.closeDate).toLocaleDateString() : ''} at ${tranche.positionReturn !== null ? `${(tranche.positionReturn * 100).toFixed(1)}%` : '—'}`
                    : '— Still Open'}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Opened</div>
                  <div className="text-white font-medium">
                    {tranche.openDate ? new Date(tranche.openDate).toLocaleDateString() : '—'}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">{tranche.status === 'Open' ? 'Still Open' : 'Closed'}</div>
                  <div className="text-white font-medium">
                    {tranche.closeDate ? new Date(tranche.closeDate).toLocaleDateString() : tranche.status}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Return</div>
                  <div className={`font-bold text-lg ${returnColor(tranche.positionReturn)}`}>
                    {tranche.positionReturn !== null
                      ? `${tranche.positionReturn * 100 >= 0 ? '+' : ''}${(tranche.positionReturn * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
              </div>

              {tranche.trades?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2 pr-4">Symbol</th>
                        <th className="text-left py-2 pr-4">Action</th>
                        <th className="text-left py-2 pr-4">Date</th>
                        <th className="text-right py-2 pr-4">Price</th>
                        <th className="text-right py-2 pr-4">Weight</th>
                        <th className="text-right py-2">Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tranche.trades.map((trade: any) => (
                        <tr key={trade.id} className="border-b border-gray-800/40">
                          <td className="py-2 pr-4 font-mono text-gray-300">{trade.symbol || '—'}</td>
                          <td className="py-2 pr-4 text-gray-400">
                            {trade.action} {trade.toOpenOrClose}
                            {trade.optionType && ` (${trade.optionType})`}
                          </td>
                          <td className="py-2 pr-4 text-gray-400">
                            {trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2 pr-4 text-right text-gray-300">
                            {trade.tradePrice ? `$${trade.tradePrice.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 pr-4 text-right text-gray-400">
                            {trade.weight ?? '—'}
                          </td>
                          <td className={`py-2 text-right font-medium ${returnColor(trade.tradeReturn)}`}>
                            {trade.tradeReturn !== null && trade.tradeReturn !== undefined
                              ? `${trade.tradeReturn >= 0 ? '+' : ''}${(trade.tradeReturn * 100).toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(tranche.investmentType === 'PUT_SELL' || tranche.investmentType === 'COVERED_CALL') &&
                tranche.trades?.some((t: any) => t.buyingPowerRequired) && (
                <div className="mt-3 bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-3 text-xs text-yellow-300">
                  Income strategy — return calculated on buying power required, not premium alone.
                  {tranche.trades.find((t: any) => t.buyingPowerRequired) && (
                    <span> Buying Power: ${tranche.trades.find((t: any) => t.buyingPowerRequired)?.buyingPowerRequired?.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
