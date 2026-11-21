'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Badge, useApp, useRun } from '@/lib/ui'

const blank = { substance: '', reaction: '', severity: 'MODERATE', notes: '' }

export default function Allergies() {
  const { pid, can, rev, viewingOther, viewing } = useApp()
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState<any>(blank)
  const [edit, setEdit] = useState<string | null>(null)
  const { run, Msg, working } = useRun()
  const base = `/patients/${pid}/allergies`
  const load = () => api(base).then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [pid, rev])
  useEffect(() => { setF(blank); setEdit(null) }, [pid])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const save = (e: any) => { e.preventDefault(); run(async () => {
    await api(edit ? `${base}/${edit}` : base, { method: edit ? 'PATCH' : 'POST', body: { substance: f.substance, reaction: f.reaction || null, severity: f.severity, notes: f.notes || null } })
    setF(blank); setEdit(null); load(); return 'Saved. Everyone on the care team can see it now.'
  }) }
  return (
    <>
      <h1>{viewingOther ? `${viewing.name}'s allergies` : 'My allergies'}</h1>
      <p className="mb-3 text-sm">Doctors use this list to choose safe medicines. Be specific about what happens when you react.</p>
      {Msg}
      {can('edit') ? (
        <form className="card" onSubmit={save}>
          <h2>{edit ? 'Edit allergy' : 'Add an allergy'}</h2>
          <div className="grid md:grid-cols-3 gap-x-3">
            <div><label>Allergic to (medicine, food, other)</label><input className="in" required value={f.substance} onChange={set('substance')} placeholder="Penicillin, peanuts, latex..." /></div>
            <div><label>What happens (reaction)</label><input className="in" value={f.reaction} onChange={set('reaction')} placeholder="Rash, swelling, trouble breathing..." /></div>
            <div><label>How serious</label><select className="in" value={f.severity} onChange={set('severity')}><option value="MILD">Mild</option><option value="MODERATE">Moderate</option><option value="SEVERE">Severe / life-threatening</option></select></div>
            <div className="md:col-span-3"><label>Extra notes for the doctor</label><textarea className="in" rows={2} value={f.notes} onChange={set('notes')} /></div>
          </div>
          <button className="btn" disabled={working}>{edit ? 'Save changes' : 'Add allergy'}</button>
          {edit && <button type="button" className="btn2" onClick={() => { setEdit(null); setF(blank) }}>Cancel</button>}
        </form>
      ) : viewingOther && <p className="card text-sm">View only. The patient has not allowed you to edit.</p>}
      {list.map((a) => (
        <div key={a.id} className="card">
          <div className="flex justify-between"><b>{a.substance}</b><Badge s={a.severity} /></div>
          {a.reaction && <p>Reaction: {a.reaction}</p>}
          {a.notes && <p className="text-sm">{a.notes}</p>}
          {can('edit') && <div className="mt-2">
            <button className="btn2" onClick={() => { setEdit(a.id); setF({ substance: a.substance, reaction: a.reaction || '', severity: a.severity, notes: a.notes || '' }); window.scrollTo(0, 0) }}>Edit</button>
            <button className="btnr" disabled={working} onClick={() => confirm(`Remove ${a.substance}?`) && run(async () => { await api(`${base}/${a.id}`, { method: 'DELETE' }); load() })}>Remove</button>
          </div>}
        </div>
      ))}
      {!list.length && <p className="card">No allergies recorded. If there are none, nothing to add.</p>}
    </>
  )
}
