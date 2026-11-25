'use client'
import { useEffect, useState } from 'react'
import { api, ymd } from '@/lib/api'
import { AllergyBanner, Badge, useApp, useRun } from '@/lib/ui'

const blank = { name: '', dosage: '', form: '', instructions: '', startDate: ymd(new Date()), endDate: '', durationDays: '', type: 'DAILY', times: ['08:00'] as string[], days: [] as number[], intervalDays: '2', pillCount: '', lowStockAt: '5', unitsPerDose: '1' }
/** Hour (1-12) + minute + AM/PM selectors. Value is stored as 24h "HH:mm" for the server. */
function TimePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h24, m] = value.split(':').map(Number)
  const pm = h24 >= 12
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const emit = (h: number, min: number, isPm: boolean) => onChange(`${String((h % 12) + (isPm ? 12 : 0)).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
  return (
    <span className="inline-flex gap-1 mr-2">
      <select className="in !w-auto !mb-0" value={h12} onChange={(e) => emit(Number(e.target.value), m, pm)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}</option>)}</select>
      <select className="in !w-auto !mb-0" value={m} onChange={(e) => emit(h12, Number(e.target.value), pm)}>{Array.from({ length: 60 }, (_, i) => i).map((x) => <option key={x} value={x}>{String(x).padStart(2, '0')}</option>)}</select>
      <select className="in !w-auto !mb-0" value={pm ? 'PM' : 'AM'} onChange={(e) => emit(h12, m, e.target.value === 'PM')}><option>AM</option><option>PM</option></select>
    </span>
  )
}
const ampm = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Meds() {
  const { pid, can, rev, viewingOther, viewing } = useApp()
  const [meds, setMeds] = useState<any[]>([])
  const [lib, setLib] = useState<any[]>([])
  const [f, setF] = useState<any>(blank)
  const [edit, setEdit] = useState<string | null>(null)
  const { run, Msg } = useRun()
  const base = `/patients/${pid}/medications`
  const load = () => api(base).then(setMeds).catch(() => setMeds([]))
  useEffect(() => { setEdit(null); setF(blank); api('/library').then(setLib).catch(() => 0) }, [pid])
  useEffect(() => { load() }, [pid, rev])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })

  const payload = () => ({
    name: f.name, dosage: f.dosage, form: f.form || undefined, instructions: f.instructions || undefined,
    startDate: f.startDate, endDate: f.endDate || null, durationDays: f.durationDays ? Number(f.durationDays) : null,
    pillCount: f.pillCount === '' ? null : Number(f.pillCount), lowStockAt: Number(f.lowStockAt) || 0, unitsPerDose: Number(f.unitsPerDose) || 1,
    schedule: { type: f.type, times: f.type === 'ASNEEDED' ? [] : [...new Set<string>(f.times)].sort(), days: f.days, intervalDays: f.type === 'INTERVAL' ? Number(f.intervalDays) || 1 : undefined },
  })
  const save = (e: any) => { e.preventDefault(); run(async () => {
    const r = await api(edit ? `${base}/${edit}` : base, { method: edit ? 'PATCH' : 'POST', body: payload() })
    setF(blank); setEdit(null); await load()
    return r.warnings?.length ? 'Saved. Warning: ' + r.warnings.join('; ') : 'Saved'
  }) }
  const startEdit = (m: any) => { setEdit(m.id); setF({ name: m.name, dosage: m.dosage, form: m.form || '', instructions: m.instructions || '', startDate: ymd(new Date(m.startDate)), endDate: m.endDate ? ymd(new Date(m.endDate)) : '', durationDays: m.durationDays || '', type: m.schedule.type, times: (m.schedule.times?.length ? m.schedule.times : ['08:00']) as string[], days: m.schedule.days || [], intervalDays: m.schedule.intervalDays || '2', pillCount: m.pillCount ?? '', lowStockAt: m.lowStockAt, unitsPerDose: m.unitsPerDose }); window.scrollTo(0, 0) }
  const status = (m: any, s: string) => run(async () => { await api(`${base}/${m.id}/status`, { body: { status: s } }); await load() })
  const del = (m: any) => confirm(`Delete ${m.name} and all its dose history?`) && run(async () => { await api(`${base}/${m.id}`, { method: 'DELETE' }); await load() })

  return (
    <>
      <h1>{viewingOther ? `${viewing.name}'s medications` : 'Medications'}</h1>
      <AllergyBanner />
      {Msg}
      {viewingOther && !can('edit') && <p className="card text-sm">View only. To add or change medications for {viewing.name}, ask them to turn on editing for you under Care team.</p>}
      {can('edit') ? (
        <form className="card" onSubmit={save}>
          <h2>{edit ? 'Edit medication' : 'Add medication'}</h2>
          <div className="grid md:grid-cols-3 gap-x-3">
            <div><label>Name</label><input className="in" list="lib" required value={f.name} onChange={(e) => { const v = e.target.value; const l = lib.find((x) => x.name === v); setF({ ...f, name: v, ...(l ? { dosage: f.dosage || l.commonDosage || '', form: f.form || l.form || '' } : {}) }) }} /><datalist id="lib">{lib.map((l) => <option key={l.id} value={l.name} />)}</datalist></div>
            <div><label>Dosage (e.g. 500 mg)</label><input className="in" required value={f.dosage} onChange={set('dosage')} /></div>
            <div><label>Form</label><input className="in" value={f.form} onChange={set('form')} placeholder="Tablet, capsule, syrup..." /></div>
            <div className="md:col-span-3"><label>Instructions</label><input className="in" value={f.instructions} onChange={set('instructions')} placeholder="After meals, with water..." /></div>
            <div><label>Start date</label><input className="in" type="date" required value={f.startDate} onChange={set('startDate')} /></div>
            <div><label>End date (optional)</label><input className="in" type="date" value={f.endDate} onChange={set('endDate')} /></div>
            <div><label>or duration in days</label><input className="in" type="number" min={1} value={f.durationDays} onChange={set('durationDays')} /></div>
            <div><label>Schedule</label><select className="in" value={f.type} onChange={set('type')}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly (pick day)</option><option value="DAYS">Specific days</option><option value="INTERVAL">Every N days</option><option value="ASNEEDED">As needed</option></select></div>
            {f.type !== 'ASNEEDED' && <div className="md:col-span-2"><label>Dose times</label>
              {f.times.map((t: string, i: number) => <div key={i} className="mb-1"><TimePick value={t} onChange={(v) => setF({ ...f, times: f.times.map((x: string, j: number) => (j === i ? v : x)) })} />{f.times.length > 1 && <button type="button" className="btnr" onClick={() => setF({ ...f, times: f.times.filter((_: string, j: number) => j !== i) })}>Remove</button>}</div>)}
              <button type="button" className="btn2" onClick={() => setF({ ...f, times: [...f.times, '20:00'] })}>+ Add another time</button></div>}
            {f.type === 'INTERVAL' && <div><label>Every N days</label><input className="in" type="number" min={1} value={f.intervalDays} onChange={set('intervalDays')} /></div>}
            {(f.type === 'DAYS' || f.type === 'WEEKLY') && <div className="md:col-span-3">{DAYS.map((d, i) => <label key={d} className="inline-block mr-4"><input type="checkbox" checked={f.days.includes(i)} onChange={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x: number) => x !== i) : [...f.days, i] })} /> {d}</label>)}</div>}
            <div><label>Pills in stock (blank = don&apos;t track)</label><input className="in" type="number" min={0} value={f.pillCount} onChange={set('pillCount')} /></div>
            <div><label>Low-stock alert at</label><input className="in" type="number" min={0} value={f.lowStockAt} onChange={set('lowStockAt')} /></div>
            <div><label>Pills per dose</label><input className="in" type="number" min={1} value={f.unitsPerDose} onChange={set('unitsPerDose')} /></div>
          </div>
          <button className="btn">{edit ? 'Save changes' : 'Add medication'}</button>
          {edit && <button type="button" className="btn2" onClick={() => { setEdit(null); setF(blank) }}>Cancel</button>}
        </form>
      ) : null}
      {meds.map((m) => (
        <div key={m.id} className="card">
          <div className="flex justify-between"><b>{m.name} - {m.dosage} {m.form && `(${m.form})`}</b><Badge s={m.status} /></div>
          <p className="text-sm">{m.schedule.type}{m.schedule.times?.length ? ' at ' + m.schedule.times.map(ampm).join(', ') : ''}{m.schedule.type === 'INTERVAL' ? ` every ${m.schedule.intervalDays} days` : ''}{m.schedule.days?.length ? ' on ' + m.schedule.days.map((d: number) => DAYS[d]).join(', ') : ''} | {new Date(m.startDate).toLocaleDateString()} to {m.endDate ? new Date(m.endDate).toLocaleDateString() : 'ongoing'}</p>
          {m.instructions && <p className="text-sm">{m.instructions}</p>}
          {m.pillCount != null && <p className={m.pillCount <= m.lowStockAt ? 'text-red-700 font-bold' : ''}>Stock: {m.pillCount} {m.pillCount <= m.lowStockAt && '(low - refill due)'}</p>}
          {can('edit') && <div className="mt-2">
            <button className="btn2" onClick={() => startEdit(m)}>Edit</button>
            {m.status === 'ACTIVE' ? <button className="btn2" onClick={() => status(m, 'PAUSED')}>Pause</button> : <button className="btn2" onClick={() => status(m, 'ACTIVE')}>Resume</button>}
            {m.status !== 'STOPPED' && <button className="btn2" onClick={() => status(m, 'STOPPED')}>Stop</button>}
            <button className="btnr" onClick={() => del(m)}>Delete</button>
          </div>}
        </div>
      ))}
      {!meds.length && <p>No medications yet.</p>}
    </>
  )
}
