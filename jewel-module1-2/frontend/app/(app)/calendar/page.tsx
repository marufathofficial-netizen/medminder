'use client'
import { useEffect, useState } from 'react'
import { api, fmtT, ymd } from '@/lib/api'
import { useApp } from '@/lib/ui'

const col: any = { TAKEN: 'bg-green-200', MISSED: 'bg-red-200', SKIPPED: 'bg-yellow-200', PENDING: 'bg-blue-100' }

export default function Calendar() {
  const { pid, rev } = useApp()
  const [view, setView] = useState<'day' | 'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [doses, setDoses] = useState<any[]>([])

  const range = () => {
    const a = new Date(anchor); a.setHours(0, 0, 0, 0)
    if (view === 'week') a.setDate(a.getDate() - a.getDay())
    if (view === 'month') { a.setDate(1); a.setDate(1 - a.getDay()) }
    const n = view === 'day' ? 1 : view === 'week' ? 7 : 42
    return Array.from({ length: n }, (_, i) => { const d = new Date(a); d.setDate(a.getDate() + i); return d })
  }
  const days = range()
  useEffect(() => {
    const to = new Date(days[days.length - 1]); to.setHours(23, 59, 59, 999)
    api(`/patients/${pid}/doses?from=${days[0].toISOString()}&to=${to.toISOString()}&take=1000`).then(setDoses).catch(() => setDoses([]))
  }, [pid, view, anchor.toDateString(), rev])
  const move = (dir: number) => { const a = new Date(anchor); if (view === 'month') a.setMonth(a.getMonth() + dir); else a.setDate(a.getDate() + dir * (view === 'week' ? 7 : 1)); setAnchor(a) }

  return (
    <>
      <h1>Calendar</h1>
      <div className="mb-3">
        {(['day', 'week', 'month'] as const).map((v) => <button key={v} className={view === v ? 'btn' : 'btn2'} onClick={() => setView(v)}>{v}</button>)}
        <button className="btn2" onClick={() => move(-1)}>&lt; Prev</button><button className="btn2" onClick={() => setAnchor(new Date())}>Today</button><button className="btn2" onClick={() => move(1)}>Next &gt;</button>
        <b className="ml-3">{anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
      </div>
      <div className={view === 'day' ? '' : 'grid grid-cols-7 gap-1'}>
        {view !== 'day' && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <b key={d} className="text-center">{d}</b>)}
        {days.map((d) => {
          const list = doses.filter((x) => ymd(new Date(x.scheduledAt)) === ymd(d))
          return (
            <div key={d.toISOString()} className={`border bg-white p-1 min-h-24 ${view === 'month' && d.getMonth() !== anchor.getMonth() ? 'opacity-50' : ''} ${ymd(d) === ymd(new Date()) ? 'ring-2 ring-blue-600' : ''}`}>
              <div className="text-sm font-bold">{d.getDate()}{view !== 'month' && ' ' + d.toLocaleDateString([], { weekday: 'short', month: 'short' })}</div>
              {list.map((x) => <div key={x.id} className={`text-xs rounded px-1 mb-0.5 ${col[x.status]}`}>{fmtT(x.scheduledAt)} {x.medication.name}</div>)}
            </div>
          )
        })}
      </div>
      <p className="text-sm mt-2">Green = taken, red = missed, yellow = skipped, blue = upcoming.</p>
    </>
  )
}
