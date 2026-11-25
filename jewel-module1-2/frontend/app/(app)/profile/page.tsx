'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useApp, useRun } from '@/lib/ui'
import { PasswordField, passwordOk } from '@/lib/password'

/** Jewel - profile editing (M1-13) and change password (M1-12). */
export default function ProfilePage() {
  const { user, reloadUser } = useApp()
  const [f, setF] = useState<any>({ ...user, conditions: (user.conditions || []).join(', ') })
  const [pw, setPw] = useState({ current: '', password: '' })
  const { run, Msg } = useRun()
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const nul = (s: any) => (s === '' || s == null ? null : s)
  const save = (e: any) => { e.preventDefault(); run(async () => {
    await api('/users/me', { method: 'PATCH', body: { name: f.name, age: f.age === '' || f.age == null ? null : Number(f.age), conditions: list(f.conditions), phone: nul(f.phone), emergencyName: nul(f.emergencyName), emergencyPhone: nul(f.emergencyPhone), timezone: f.timezone } })
    await reloadUser(); return 'Settings saved'
  }) }

  return (
    <>
      <h1>Profile</h1>
      {Msg}
      <form className="card" onSubmit={save}>
        <h2>Personal details</h2>
        <div className="grid md:grid-cols-2 gap-x-3">
          <div><label>Name</label><input className="in" value={f.name} onChange={set('name')} /></div>
          <div><label>Age</label><input className="in" type="number" value={f.age ?? ''} onChange={set('age')} /></div>
          <div><label>Chronic conditions (comma separated)</label><input className="in" value={f.conditions} onChange={set('conditions')} /></div>
          <div><label>Phone</label><input className="in" value={f.phone ?? ''} onChange={set('phone')} /></div>
          <div><label>Timezone</label><input className="in" value={f.timezone} onChange={set('timezone')} /></div>
          <div><label>Emergency contact name</label><input className="in" value={f.emergencyName ?? ''} onChange={set('emergencyName')} /></div>
          <div><label>Emergency contact phone</label><input className="in" value={f.emergencyPhone ?? ''} onChange={set('emergencyPhone')} /></div>
        </div>
        <button className="btn mt-2">Save settings</button>
      </form>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (!passwordOk(pw.password)) return run(async () => { throw new Error('Your new password does not meet all the rules.') }); run(async () => { const m = (await api('/auth/change-password', { body: pw })).message; setPw({ current: '', password: '' }); return m }) }}>
        <h2>Change password</h2>
        <input className="in" type="password" required placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <PasswordField label="New password" value={pw.password} onChange={(v) => setPw({ ...pw, password: v })} />
        <button className="btn">Change password</button>
      </form>
    </>
  )
}
