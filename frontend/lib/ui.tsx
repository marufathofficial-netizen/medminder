'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
export const AppCtx = createContext<any>(null)
export const useApp = () => useContext(AppCtx)
/** run(fn): executes fn, captures errors into `Err` banner. A second call while one is running is ignored (stops double-click problems). */
export function useRun() {
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [working, setWorking] = useState(false)
  const busy = useRef(false)
  const run = async (fn: () => Promise<any>) => {
    if (busy.current) return
    busy.current = true; setWorking(true)
    try { setErr(''); setMsg(''); const r = await fn(); if (typeof r === 'string') setMsg(r) } catch (e: any) { setErr(e.message) }
    finally { busy.current = false; setWorking(false) }
  }
  const Msg = <>{err && <p className="text-red-700 my-2">{err}</p>}{msg && <p className="text-green-700 my-2">{msg}</p>}</>
  return { run, Msg, setErr, working }
}
export const Badge = ({ s }: { s: string }) => {
  const c: any = { TAKEN: 'bg-green-200', MISSED: 'bg-red-200', SKIPPED: 'bg-yellow-200', PENDING: 'bg-blue-100', ACTIVE: 'bg-green-200', PAUSED: 'bg-yellow-200', STOPPED: 'bg-gray-300', SUSPENDED: 'bg-red-200', DEACTIVATED: 'bg-gray-300', REJECTED: 'bg-red-200', MILD: 'bg-yellow-100', MODERATE: 'bg-orange-200', SEVERE: 'bg-red-300' }
  return <span className={`px-2 py-0.5 rounded text-sm ${c[s] || 'bg-gray-200'}`}>{s}</span>
}
/** Allergies of the patient being viewed, shown on every screen where a drug could be chosen. Reloads live. */
export function AllergyBanner() {
  const { pid, rev } = useApp()
  const [list, setList] = useState<any[] | null>(null)
  useEffect(() => { api(`/patients/${pid}/allergies`).then(setList).catch(() => setList(null)) }, [pid, rev])
  if (!list) return null
  if (!list.length) return <p className="card text-sm bg-gray-50">No allergies recorded. <Link className="underline" href="/allergies">Allergies</Link></p>
  return (
    <div className="card border-red-600 border-2 bg-red-50">
      <b className="text-red-800">Allergies:</b>{' '}
      {list.map((a, i) => <span key={a.id}>{i > 0 && ', '}<b>{a.substance}</b>{a.reaction ? ` (${a.reaction})` : ''} <Badge s={a.severity} /></span>)}{' '}
      <Link className="underline text-sm" href="/allergies">details</Link>
    </div>
  )
}
