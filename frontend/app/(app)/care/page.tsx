'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Badge, useApp, useRun } from '@/lib/ui'

const LABEL: any = { meds: 'See medications & prescriptions', adherence: 'See dose history', journal: 'See symptom journal', measurements: 'See health measurements', documents: 'See documents', edit: 'Allow them to EDIT for me (medications, prescriptions, allergies, log doses)' }
const PERMS = Object.keys(LABEL)

export default function Care() {
  const { user, rev, reloadUser } = useApp()
  const [links, setLinks] = useState<any>({ asPatient: [], asMember: [], invitesForMe: [] })
  const [f, setF] = useState<any>({ email: '', type: 'CAREGIVER', perms: ['meds', 'adherence', 'journal', 'measurements'] })
  const [req, setReq] = useState('')
  const { run, Msg, working } = useRun()
  const load = () => api('/links').then(setLinks)
  useEffect(() => { load() }, [rev])
  const toggle = (arr: string[], p: string) => (arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p])
  const setPerms = (l: any, p: string) => run(async () => { await api(`/links/${l.id}/perms`, { method: 'PATCH', body: { perms: toggle(l.perms, p) } }); load() })
  const locked = (l: any, p: string) => l.type === 'DOCTOR' && p === 'meds'

  return (
    <>
      <h1>Care team</h1>
      {Msg}
      {links.invitesForMe?.length > 0 && (
        <div className="card border-blue-600 border-2">
          <h2>Invitations for you</h2>
          {links.invitesForMe.map((i: any) => (
            <div key={i.id} className="py-1"><b>{i.patient.name}</b> invited you as their {i.type.toLowerCase()}.{' '}
              <button className="btn" disabled={working} onClick={() => run(async () => { await api('/links/accept', { body: { token: i.token } }); await load(); await reloadUser(); return 'Linked. Open "My patients" to see them.' })}>Accept</button></div>
          ))}
        </div>
      )}
      {user.role !== 'ADMIN' && <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/links/invite', { body: f }); setF({ ...f, email: '' }); load(); return 'Invitation sent by email' }) }}>
        <h2>Invite a caregiver or doctor</h2>
        <input className="in" type="email" required placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select className="in" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="CAREGIVER">Caregiver / family</option><option value="DOCTOR">Doctor</option></select>
        <p className="text-sm mb-1">What they can see / do (you can change this any time):</p>
        {PERMS.map((p) => <label key={p} className="block mr-4"><input type="checkbox" checked={f.perms.includes(p) || (f.type === 'DOCTOR' && p === 'meds')} disabled={f.type === 'DOCTOR' && p === 'meds'} onChange={() => setF({ ...f, perms: toggle(f.perms, p) })} /> {LABEL[p]}</label>)}
        <button className="btn mt-2" disabled={working}>Send invitation</button>
      </form>}
      <h2>People with access to my data</h2>
      {links.asPatient.map((l: any) => (
        <div key={l.id} className="card">
          <b>{l.member?.name || l.inviteEmail}</b> ({l.type.toLowerCase()}) <Badge s={l.status} />
          {l.status === 'PENDING' && l.initiatedBy === 'MEMBER' && <button className="btn ml-3" disabled={working} onClick={() => run(async () => { await api(`/links/${l.id}/approve`, { body: {} }); load() })}>Approve request</button>}
          {l.status === 'PENDING' && l.initiatedBy === 'PATIENT' && <span className="text-sm ml-2">(waiting for them to accept)</span>}
          <div className="mt-1">{PERMS.map((p) => <label key={p} className="block text-sm"><input type="checkbox" checked={l.perms.includes(p)} disabled={working || locked(l, p)} onChange={() => setPerms(l, p)} /> {LABEL[p]}</label>)}</div>
          <button className="btnr mt-1" disabled={working} onClick={() => confirm('Remove access?') && run(async () => { await api(`/links/${l.id}`, { method: 'DELETE' }); load() })}>Revoke / remove</button>
        </div>
      ))}
      {!links.asPatient.length && <p className="mb-4">Nobody yet.</p>}
      {(user.role === 'DOCTOR' || user.role === 'CAREGIVER') && <>
        <h2>Request access to a patient</h2>
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => (await api('/links/request', { body: { patientEmail: req } })).message) }}>
          <input className="in" type="email" required placeholder="Patient's email (they must approve)" value={req} onChange={(e) => setReq(e.target.value)} /><button className="btn" disabled={working}>Send request</button>
        </form>
      </>}
      {links.asMember.length > 0 && <><h2>Patients I follow</h2>
        {links.asMember.map((l: any) => <div key={l.id} className="card"><b>{l.patient.name}</b> <Badge s={l.status} /> {l.status === 'ACTIVE' && <span className="text-sm ml-2">{l.perms.includes('edit') ? 'You may edit on their behalf' : 'View only'}</span>}<button className="btnr ml-3" disabled={working} onClick={() => confirm('Stop following?') && run(async () => { await api(`/links/${l.id}`, { method: 'DELETE' }); load() })}>Leave</button></div>)}</>}
    </>
  )
}
