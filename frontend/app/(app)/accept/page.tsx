'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useApp, useRun } from '@/lib/ui'

export default function Accept() {
  const { run, Msg } = useRun()
  const { reloadUser } = useApp()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return // React dev mode runs effects twice; only accept once
    started.current = true
    run(async () => { const r = await api('/links/accept', { body: { token: new URLSearchParams(location.search).get('token') } }); await reloadUser(); return r.message + ' You can now follow this patient under "My patients".' })
  }, [])
  return (<><h1>Invitation</h1>{Msg}<Link className="underline" href="/patients">Go to my patients</Link></>)
}
