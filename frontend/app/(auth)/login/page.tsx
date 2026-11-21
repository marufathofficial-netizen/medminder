'use client'
import { useState } from 'react'
import Link from 'next/link'
import { api, setSession } from '@/lib/api'
import { useRun } from '@/lib/ui'

export default function Login() {
  const [f, setF] = useState({ email: '', password: '', otp: '' })
  const [need, setNeed] = useState(false)
  const { run, Msg } = useRun()
  const submit = (e: any) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/login', { body: { ...f, otp: f.otp || undefined } })
    if (r.twoFactorRequired) { setNeed(true); return 'A login code was emailed to you.' }
    setSession(r)
    window.location.href = new URLSearchParams(location.search).get('next') || (r.user.role === 'ADMIN' ? '/admin' : '/dashboard')
  }) }
  return (
    <main className="max-w-md mx-auto p-6">
      <h1>MedMinder - Log in</h1>
      <form onSubmit={submit} className="card">
        <label>Email</label><input className="in" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <label>Password</label><input className="in" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {need && <><label>Login code (from email)</label><input className="in" value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value })} /></>}
        {Msg}
        <button className="btn" type="submit">Log in</button>
      </form>
      <p><Link className="underline" href="/register">Create account</Link> | <Link className="underline" href="/forgot">Forgot password</Link> | <Link className="underline" href="/verify">Resend verification</Link></p>
    </main>
  )
}
