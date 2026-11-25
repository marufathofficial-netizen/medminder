'use client'
import { useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useRun } from '@/lib/ui'

export default function Forgot() {
  const [email, setEmail] = useState('')
  const { run, Msg } = useRun()
  return (
    <main className="max-w-md mx-auto p-6">
      <h1>Forgot password</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => (await api('/auth/forgot', { body: { email } })).message) }}>
        <input className="in" type="email" required placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {Msg}<button className="btn">Send reset link</button>
      </form>
      <Link className="underline" href="/login">Back to login</Link>
    </main>
  )
}
