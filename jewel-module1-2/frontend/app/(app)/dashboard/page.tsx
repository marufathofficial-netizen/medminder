'use client'
import { useEffect, useState } from 'react'
import { api, fmtT } from '@/lib/api'
import { AllergyBanner, Badge, useApp, useRun } from '@/lib/ui'

export default function Dashboard() {
  const { pid, can, user, rev } = useApp()
  const [doses, setDoses] = useState<any[]>([])
  const [meds, setMeds] = useState<any[]>([])
  const { run, Msg } = useRun()
  const base = `/patients/${pid}`

  const load = async () => {
    const a = new Date(); a.setHours(0, 0, 0, 0)
    const b = new Date(); b.setHours(23, 59, 59, 999)
    try {
      setDoses(await api(`${base}/doses?from=${a.toISOString()}&to=${b.toISOString()}`))
      setMeds(await api(`${base}/medications`))
    } catch (e: any) { setDoses([]); }
  }
  useEffect(() => { load() }, [pid, rev])

  const log = (d: any, status: string, extra: any = {}) => run(async () => { await api(`${base}/doses/${d.id}/log`, { body: { status, ...extra } }); await load() })
  const skip = (d: any) => { const r = prompt('Reason for skipping?'); if (r !== null) log(d, 'SKIPPED', { skipReason: r }) }
  const note = (d: any) => { const s = prompt('Side effects / notes?'); if (s) log(d, d.status, { sideEffects: s }) }
  const snooze = (d: any) => run(async () => { await api(`${base}/doses/${d.id}/snooze`, { body: { minutes: 15 } }); return 'Snoozed 15 minutes' })
  const resched = (d: any) => { const t = prompt('New time today (HH:MM, 24h)?'); if (!t) return; const [h, m] = t.split(':').map(Number); const x = new Date(); x.setHours(h, m, 0, 0); run(async () => { await api(`${base}/doses/${d.id}/reschedule`, { body: { scheduledAt: x.toISOString() } }); await load() }) }
  const adhoc = (m: any) => run(async () => { await api(`${base}/doses`, { body: { medicationId: m.id, status: 'TAKEN' } }); await load() })

  return (
    <>
      <h1>Today&apos;s doses</h1>
      <AllergyBanner />
      {Msg}
      {!doses.length && <p className="card">No doses scheduled today. Add medications under Medications.</p>}
      {doses.map((d) => (
        <div key={d.id} className="card">
          <div className="flex justify-between"><b>{fmtT(d.scheduledAt)} - {d.medication.name} <span className="font-normal">{d.medication.dosage}</span></b><Badge s={d.status} /></div>
          {d.skipReason && <p className="text-sm">Skipped: {d.skipReason}</p>}{d.sideEffects && <p className="text-sm">Notes: {d.sideEffects}</p>}
          {can('edit') && <div className="mt-2">
            <button className="btn" onClick={() => log(d, 'TAKEN')}>Taken</button>
            <button className="btn2" onClick={() => skip(d)}>Skip</button>
            <button className="btn2" onClick={() => log(d, 'MISSED')}>Missed</button>
            {d.status === 'PENDING' && <><button className="btn2" onClick={() => snooze(d)}>Snooze 15m</button><button className="btn2" onClick={() => resched(d)}>Reschedule</button></>}
            <button className="btn2" onClick={() => note(d)}>Add note</button>
          </div>}
        </div>
      ))}
      {can('edit') && meds.filter((m) => m.status === 'ACTIVE' && m.schedule?.type === 'ASNEEDED').length > 0 && (
        <div className="card"><h2>As-needed medications</h2>
          {meds.filter((m) => m.status === 'ACTIVE' && m.schedule?.type === 'ASNEEDED').map((m) => <button key={m.id} className="btn" onClick={() => adhoc(m)}>Log {m.name} taken now</button>)}
        </div>
      )}
      {user.role !== 'PATIENT' && pid === 'me' && <p className="text-sm">Tip: use &quot;My patients&quot; to select a patient to monitor.</p>}
    </>
  )
}
