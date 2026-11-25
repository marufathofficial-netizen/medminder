'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Badge, useApp, useRun } from '@/lib/ui'

/** Jewel - Module 2 feature 16: the patient decides what each caregiver / doctor can see or edit. */
const LABEL: any = { meds: 'See medications & prescriptions', adherence: 'See dose history', journal: 'See symptom journal', measurements: 'See health measurements', documents: 'See documents', edit: 'Allow them to EDIT for me (medications, prescriptions, allergies, log doses)' }
const PERMS = Object.keys(LABEL)

export default function Permissions() {
  const { rev } = useApp()
  const [people, setPeople] = useState<any[]>([])
  const { run, Msg, working } = useRun()
  const load = () => api('/links/mine').then(setPeople)
  useEffect(() => { load() }, [rev])
  const toggle = (arr: string[], p: string) => (arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p])
  const setPerms = (l: any, p: string) => run(async () => { await api(`/links/${l.id}/perms`, { method: 'PATCH', body: { perms: toggle(l.perms, p) } }); load() })
  const locked = (l: any, p: string) => l.type === 'DOCTOR' && p === 'meds'

  return (
    <>
      <h1>Who can see my data</h1>
      {Msg}
      {people.map((l: any) => (
        <div key={l.id} className="card">
          <b>{l.member?.name || l.inviteEmail}</b> ({l.type.toLowerCase()}) <Badge s={l.status} />
          <div className="mt-1">{PERMS.map((p) => <label key={p} className="block text-sm"><input type="checkbox" checked={l.perms.includes(p)} disabled={working || locked(l, p)} onChange={() => setPerms(l, p)} /> {LABEL[p]}</label>)}</div>
          <button className="btnr mt-1" disabled={working} onClick={() => confirm('Remove access?') && run(async () => { await api(`/links/${l.id}`, { method: 'DELETE' }); load() })}>Revoke / remove</button>
        </div>
      ))}
      {!people.length && <p className="mb-4">Nobody yet.</p>}
    </>
  )
}
