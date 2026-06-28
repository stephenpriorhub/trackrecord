'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, useCallback, useRef } from 'react'

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

const SPREAD_OPTIONS = [
  { value: 'STRANGLE', label: 'Strangle' },
  { value: 'IRON_CONDOR', label: 'Iron Condor' },
  { value: 'PUT_CREDIT_SPREAD', label: 'Vertical Credit Spread (Put)' },
  { value: 'CALL_CREDIT_SPREAD', label: 'Vertical Credit Spread (Call)' },
  { value: 'PUT_DEBIT_SPREAD', label: 'Vertical Debit Spread (Put)' },
  { value: 'CALL_DEBIT_SPREAD', label: 'Vertical Debit Spread (Call)' },
  { value: 'CALENDAR', label: 'Calendar Spread' },
  { value: 'DIAGONAL', label: 'Diagonal Spread' },
]

const SPREAD_LABELS: Record<string, string> = {
  STRANGLE: 'Strangle',
  IRON_CONDOR: 'Iron Condor',
  PUT_CREDIT_SPREAD: 'Put Credit Spread',
  CALL_CREDIT_SPREAD: 'Call Credit Spread',
  PUT_DEBIT_SPREAD: 'Put Debit Spread',
  CALL_DEBIT_SPREAD: 'Call Debit Spread',
  CALENDAR: 'Calendar',
  DIAGONAL: 'Diagonal',
}

function getSpreadReason(spreadType: string, posName: string): string {
  const n = posName.toLowerCase()
  switch (spreadType) {
    case 'IRON_CONDOR':
      return n.includes('iron condor')
        ? 'Position name contains "iron condor"'
        : 'Has both call and put legs with 4+ trades'
    case 'STRANGLE':
      return n.includes('strangle')
        ? 'Position name contains "strangle"'
        : 'Has both call and put legs'
    case 'CALENDAR':
      return 'Position name contains "calendar"'
    case 'DIAGONAL':
      return 'Position name contains "diagonal"'
    case 'PUT_CREDIT_SPREAD':
      return n.includes('credit spread') || n.includes('put credit')
        ? 'Position name contains credit spread terms'
        : 'Strike range pattern detected in name (e.g. $150/$145 put)'
    case 'CALL_CREDIT_SPREAD':
      return n.includes('credit spread') || n.includes('call credit')
        ? 'Position name contains credit spread terms'
        : 'Strike range pattern detected in name (e.g. $150/$155 call)'
    case 'PUT_DEBIT_SPREAD':
      return n.includes('put spread') ? 'Position name contains "put spread"' : 'Position name contains "debit spread" with put'
    case 'CALL_DEBIT_SPREAD':
      return n.includes('call spread') ? 'Position name contains "call spread"' : 'Position name contains "debit spread" with call'
    default:
      return spreadType
  }
}

// positionReturn is stored as a decimal (0.18 = 18%)
function returnColor(r: number | null | undefined) {
  if (r === null || r === undefined) return 'text-gray-400'
  return r >= 0 ? 'text-green-400' : 'text-red-400'
}

// stats route returns values already converted to % (e.g. 18.0 for 18%)
function statColor(v: number | null | undefined) {
  if (v === null || v === undefined) return 'text-white'
  return v >= 0 ? 'text-green-400' : 'text-red-400'
}

function FilterDropdown({
  label, options, selected, onChange, single
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (vals: string[]) => void
  single?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const summary = selected.length === 0
    ? `All ${label}`
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white hover:bg-gray-700 transition-colors w-full sm:w-auto sm:min-w-[160px] justify-between"
      >
        <span className={selected.length === 0 ? 'text-gray-400' : 'text-white'}>{summary}</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl min-w-[200px] py-1">
          {!single && selected.length > 0 && (
            <button
              onClick={() => { onChange([]); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-700 border-b border-gray-700"
            >
              Clear selection
            </button>
          )}
          {options.map(o => {
            const active = selected.includes(o.value)
            return (
              <button
                key={o.value}
                onClick={() => {
                  if (single) { onChange(active ? [] : [o.value]); setOpen(false) }
                  else onChange(active ? selected.filter(v => v !== o.value) : [...selected, o.value])
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-700 transition-colors ${active ? 'text-white' : 'text-gray-300'}`}
              >
                {!single && (
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${active ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}>
                    {active && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </span>
                )}
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
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
  const [spreadTypes, setSpreadTypes] = useState<string[]>([])
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
    if (spreadTypes.length) p.set('spreadTypes', spreadTypes.join(','))
    if (status !== 'all') p.set('status', status)
    return p.toString()
  }, [pubCodes, gurus, types, spreadTypes, status])

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

  useEffect(() => { setPage(1) }, [pubCodes, gurus, types, spreadTypes, status])

  function toggle(arr: string[], val: string, set: (v: string[]) => void) {
    set(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
  }

  const s = stats?.summary

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">MTA Track Record</h1>
          <p className="text-sm sm:text-base text-gray-400 mt-1">Monument Traders Alliance — Live portfolio performance</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-full sm:w-auto">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Publication</div>
              <FilterDropdown label="Publications" options={PUB_OPTIONS} selected={pubCodes} onChange={setPubCodes} />
            </div>
            <div className="w-full sm:w-auto">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Guru</div>
              <FilterDropdown label="Gurus" options={GURU_OPTIONS} selected={gurus} onChange={setGurus} />
            </div>
            <div className="w-full sm:w-auto">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Strategy</div>
              <FilterDropdown label="Strategies" options={TYPE_OPTIONS} selected={types} onChange={setTypes} />
            </div>
            <div className="w-full sm:w-auto">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Spread Type</div>
              <FilterDropdown label="Spread Types" options={SPREAD_OPTIONS} selected={spreadTypes} onChange={setSpreadTypes} />
            </div>
            <div className="w-full sm:w-auto">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</div>
              <FilterDropdown
                label="Status"
                options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]}
                selected={status === 'all' ? [] : [status]}
                onChange={vals => setStatus(vals.length ? vals[vals.length - 1] : 'all')}
                single
              />
            </div>
            {(pubCodes.length > 0 || gurus.length > 0 || types.length > 0 || spreadTypes.length > 0 || status !== 'all') && (
              <button
                onClick={() => { setPubCodes([]); setGurus([]); setTypes([]); setSpreadTypes([]); setStatus('all') }}
                className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-2 hover:border-gray-500 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {s && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Trade Summary</div>
              <div className="text-xs text-gray-600">{s.total.toLocaleString()} closed · {stats?.openCount ?? 0} open</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1"># of Trades</div>
                <div className="text-2xl font-bold text-white">{s.total.toLocaleString()}</div>
                <div className="text-xs text-gray-600 mt-1">{s.winners}W · {s.losers}L</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1"># of Winners</div>
                <div className="text-2xl font-bold text-green-400">{s.winners.toLocaleString()}</div>
                <div className="text-xs text-gray-600 mt-1">{s.losers} losers</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Win Rate</div>
                <div className="text-2xl font-bold text-white">{s.winRate}%</div>
                <div className="text-xs text-gray-600 mt-1">{s.winners}/{s.total}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Trade</div>
                <div className={`text-2xl font-bold ${statColor(s.avgReturn)}`}>
                  {s.avgReturn !== null ? `${s.avgReturn >= 0 ? '+' : ''}${s.avgReturn}%` : '—'}
                </div>
                <div className="text-xs text-gray-600 mt-1">simple avg</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Weighted</div>
                <div className={`text-2xl font-bold ${statColor(s.avgWeightedReturn)}`}>
                  {s.avgWeightedReturn !== null ? `${s.avgWeightedReturn >= 0 ? '+' : ''}${s.avgWeightedReturn}%` : '—'}
                </div>
                <div className="text-xs text-gray-600 mt-1">by position size</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Duration</div>
                <div className="text-2xl font-bold text-white">{s.avgDaysHeld ? `${s.avgDaysHeld}d` : '—'}</div>
                <div className="text-xs text-gray-600 mt-1">days held</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Largest Trade</div>
                <div className="text-2xl font-bold text-green-400">
                  {s.largestWinner !== null ? `+${s.largestWinner}%` : '—'}
                </div>
                <div className={`text-xs mt-1 ${statColor(s.largestLoser)}`}>
                  worst: {s.largestLoser !== null ? `${s.largestLoser}%` : '—'}
                </div>
              </div>
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
                    <th className="text-left px-3 py-3">Spread</th>
                    <th className="text-left px-3 py-3">Entry</th>
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
                      <td className="px-3 py-3">
                        {pos.spreadType ? (
                          <span
                            title={getSpreadReason(pos.spreadType, pos.name || '')}
                            className="text-xs bg-purple-900/40 text-purple-300 border border-purple-800/50 rounded px-2 py-0.5 cursor-help"
                          >
                            {SPREAD_LABELS[pos.spreadType] ?? pos.spreadType}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-300">
                        {(() => {
                          const openTrade = pos.trades?.find((t: any) => t.toOpenOrClose === 'Open' && t.tradePrice)
                          if (!openTrade) return <span className="text-gray-600">—</span>
                          const isOption = ['CALL','PUT','PUT_SELL','COVERED_CALL','PUT_CREDIT_SPREAD','CALL_CREDIT_SPREAD','PUT_DEBIT_SPREAD','CALL_DEBIT_SPREAD','STRANGLE','IRON_CONDOR'].includes(pos.investmentType)
                          const price = openTrade.tradePrice
                          const costLabel = isOption ? `$${(price * 100).toFixed(2)}/contract` : `$${price.toFixed(2)}/share`
                          return <span title={`Trade price: $${price}`}>{costLabel}</span>
                        })()}
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
        <div className="flex justify-between items-start p-4 sm:p-6 border-b border-gray-800">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white">{position.name}</h2>
            <div className="text-sm text-gray-400 mt-1">
              {(position.symbols || []).join(', ')} · {position.portfolio?.pubCode} · {position.investmentType}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
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
