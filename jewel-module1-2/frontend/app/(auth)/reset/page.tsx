'use client'
import { useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useRun } from '@/lib/ui'
import { PasswordField, passwordOk } from '@/lib/password'

export default function Reset() {
  const [password, setPassword] = useState('')
  const { run, Msg } = useRun()
  return (
    <main className="max-w-md mx-auto p-6">
      <h1>Choose a new password</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (!passwordOk(password)) return run(async () => { throw new Error('Your password does not meet all the rules.') }); run(async () => (await api('/auth/reset', { body: { token: new URLSearchParams(location.search).get('token'), password } })).message) }}>
        <PasswordField label="New password" value={password} onChange={setPassword} />
        {Msg}<button className="btn">Update password</button>
      </form>
      <Link className="underline" href="/login">Back to login</Link>
    </main>
  )
}
