'use client'
import { useState } from 'react'
import { API, api, clearSession } from '@/lib/api'
import { useApp, useRun } from '@/lib/ui'
import { PasswordField, passwordOk } from '@/lib/password'

const urlB64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))) }

export default function Settings() {
  const { user, reloadUser } = useApp()
  const [f, setF] = useState<any>({ ...user, conditions: (user.conditions || []).join(', ') })
  const [pw, setPw] = useState({ current: '', password: '' })
  const { run, Msg } = useRun()
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const nul = (s: any) => (s === '' || s == null ? null : s)
  const save = (e: any) => { e.preventDefault(); run(async () => {
    await api('/users/me', { method: 'PATCH', body: { name: f.name, age: f.age === '' || f.age == null ? null : Number(f.age), conditions: list(f.conditions), phone: nul(f.phone), emergencyName: nul(f.emergencyName), emergencyPhone: nul(f.emergencyPhone), timezone: f.timezone, shareProfile: !!f.shareProfile, leadMinutes: Number(f.leadMinutes) || 0, quietStart: nul(f.quietStart), quietEnd: nul(f.quietEnd), channels: f.channels, twoFactorEnabled: !!f.twoFactorEnabled } })
    await reloadUser(); return 'Settings saved'
  }) }
  const ch = (c: string) => setF({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x: string) => x !== c) : [...f.channels, c] })
  const push = () => run(async () => {
    const { key } = await api('/notifications/vapid')
    if (!key) throw new Error('Web push is not configured on the server (set VAPID keys).')
    const reg = await navigator.serviceWorker.register('/sw.js')
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notification permission denied')
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) })
    await api('/users/me/push', { body: { subscription: sub.toJSON() } })
    if (!f.channels.includes('PUSH')) await api('/users/me', { method: 'PATCH', body: { channels: [...f.channels, 'PUSH'] } })
    await reloadUser(); return 'Push enabled on this device'
  })
  const exp = () => run(async () => { const d = await api('/users/me/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'medminder-data.json'; a.click() })
  const deactivate = () => confirm('Deactivate your account? Logging in again reactivates it.') && run(async () => { await api('/users/me/deactivate', { body: {} }); clearSession(); window.location.href = '/login' })
  const del = () => { const p = prompt('Type your password to PERMANENTLY delete your account and all data'); if (p) run(async () => { await api('/users/me', { method: 'DELETE', body: { password: p } }); clearSession(); window.location.href = '/login' }) }

  return (
    <>
      <h1>Settings</h1>
      {Msg}
      <form className="card" onSubmit={save}>
        <h2>Profile</h2>
        <p className="text-sm mb-2">Allergies now have their own page: open <b>Allergies</b> in the menu.</p>
        <div className="grid md:grid-cols-2 gap-x-3">
          <div><label>Name</label><input className="in" value={f.name} onChange={set('name')} /></div>
          <div><label>Age</label><input className="in" type="number" value={f.age ?? ''} onChange={set('age')} /></div>
          <div><label>Chronic conditions (comma separated)</label><input className="in" value={f.conditions} onChange={set('conditions')} /></div>
          <div><label>Phone</label><input className="in" value={f.phone ?? ''} onChange={set('phone')} /></div>
          <div><label>Timezone</label><input className="in" value={f.timezone} onChange={set('timezone')} /></div>
          <div><label>Emergency contact name</label><input className="in" value={f.emergencyName ?? ''} onChange={set('emergencyName')} /></div>
          <div><label>Emergency contact phone</label><input className="in" value={f.emergencyPhone ?? ''} onChange={set('emergencyPhone')} /></div>
        </div>
        <h2 className="mt-3">Reminder preferences</h2>
        <div className="grid md:grid-cols-3 gap-x-3">
          <div><label>Remind me N minutes before</label><input className="in" type="number" min={0} max={120} value={f.leadMinutes} onChange={set('leadMinutes')} /></div>
          <div><label>Quiet hours start</label><input className="in" type="time" value={f.quietStart ?? ''} onChange={set('quietStart')} /></div>
          <div><label>Quiet hours end</label><input className="in" type="time" value={f.quietEnd ?? ''} onChange={set('quietEnd')} /></div>
        </div>
        {['INAPP', 'EMAIL', 'PUSH'].map((c) => <label key={c} className="inline-block mr-4"><input type="checkbox" checked={f.channels.includes(c)} onChange={() => ch(c)} /> {c === 'INAPP' ? 'In-app' : c === 'EMAIL' ? 'Email' : 'Web push'}</label>)}
        <h2 className="mt-3">Privacy &amp; security</h2>
        <label><input type="checkbox" checked={!!f.shareProfile} onChange={set('shareProfile')} /> Let linked caregivers/doctors see my profile details (age, conditions, phone). Allergies are always visible to your doctors and caregivers for your safety.</label>
        <label><input type="checkbox" checked={!!f.twoFactorEnabled} onChange={set('twoFactorEnabled')} /> Two-factor login (code sent by email)</label>
        <button className="btn mt-2">Save settings</button><button type="button" className="btn2" onClick={push}>Enable web push on this device</button>
      </form>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (!passwordOk(pw.password)) return run(async () => { throw new Error('Your new password does not meet all the rules.') }); run(async () => { const m = (await api('/auth/change-password', { body: pw })).message; setPw({ current: '', password: '' }); return m }) }}>
        <h2>Change password</h2>
        <input className="in" type="password" required placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <PasswordField label="New password" value={pw.password} onChange={(v) => setPw({ ...pw, password: v })} />
        <button className="btn">Change password</button>
      </form>
      <div className="card"><h2>Your data</h2><button className="btn2" onClick={exp}>Export my data (JSON)</button><button className="btn2" onClick={deactivate}>Deactivate account</button><button className="btnr" onClick={del}>Delete account permanently</button></div>
    </>
  )
}
