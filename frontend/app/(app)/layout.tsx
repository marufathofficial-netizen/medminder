'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { io } from 'socket.io-client'
import { API, ALL_PERMS, api, clearSession } from '@/lib/api'
import { AppCtx } from '@/lib/ui'

export default function Shell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [patients, setPatients] = useState<any[]>([])
  const [pid, setPidState] = useState('me')
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState('')
  const [rev, setRev] = useState(0) // bumped whenever anyone linked to the viewed patient changes something -> every page reloads
  const path = usePathname()
  const userRef = useRef<any>(null)

  const setPid = (id: string) => { if (userRef.current) localStorage.setItem('pid:' + userRef.current.id, id); setPidState(id) }

  const loadUser = useCallback(async () => {
    try {
      const u = await api('/users/me'); userRef.current = u; setUser(u)
      let list: any[] = []
      if (u.role === 'CAREGIVER' || u.role === 'DOCTOR') list = await api('/links/patients')
      setPatients(list)
      // Doctors/caregivers must be looking at a patient, not at their own empty account: keep the last choice, else the first patient.
      setPidState((cur) => {
        if (cur !== 'me' && list.some((p) => p.patient.id === cur)) return cur
        const saved = localStorage.getItem('pid:' + u.id)
        if (saved === 'me' && u.role !== 'DOCTOR') return 'me'
        if (saved && list.some((p) => p.patient.id === saved)) return saved
        return u.role !== 'PATIENT' && u.role !== 'ADMIN' && list.length ? list[0].patient.id : 'me'
      })
      setUnread((await api('/notifications?limit=1')).unread)
      return u
    } catch { window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search) }
  }, [])
  useEffect(() => { loadUser() }, [loadUser])

  // live connection: server pushes "sync" whenever the patient, a doctor or a caregiver changes something
  useEffect(() => {
    if (!user) return
    const s = io(API, { auth: (cb: any) => cb({ token: localStorage.getItem('at') }) })
    const reconnect = async () => { try { await api('/users/me') } catch { /* refreshes the token if it expired */ } setTimeout(() => s.connect(), 1500) }
    s.on('disconnect', (reason: string) => { if (reason === 'io server disconnect') reconnect() })
    s.on('notification', (n: any) => { setUnread((x) => x + 1); setToast(n.title + ' - ' + n.body); setTimeout(() => setToast(''), 8000); setRev((x) => x + 1) })
    s.on('sync', (e: any) => { setRev((x) => x + 1); if (['links', 'profile'].includes(e?.what)) loadUser() })
    // safety net: even if the socket is blocked, everything refreshes every 20 s while the tab is visible
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRev((x) => x + 1) }, 20000)
    return () => { s.disconnect(); clearInterval(t) }
  }, [user?.id, loadUser])

  if (!user) return <p className="p-6">Loading...</p>
  const link = patients.find((p) => p.patient.id === pid)
  const perms = pid === 'me' ? ALL_PERMS : link?.perms || []
  const viewingOther = pid !== 'me' && !!link
  const isMember = user.role === 'DOCTOR' || user.role === 'CAREGIVER'
  const nav: [string, string][] = user.role === 'ADMIN'
    ? [['/admin', 'Admin'], ['/settings', 'Settings']]
    : [...(isMember ? [['/patients', 'My patients']] : []), ['/overview', 'Overview'], ['/dashboard', 'Today'], ['/meds', 'Medications'], ['/allergies', 'Allergies'], ['/prescriptions', 'Prescriptions'], ['/calendar', 'Calendar'], ['/health', 'Health'], ['/reports', 'Reports'], ['/care', 'Care team'], ['/notifications', `Notifications${unread ? ' (' + unread + ')' : ''}`], ['/settings', 'Settings']] as any
  const logout = async () => { await api('/auth/logout', { body: { refreshToken: localStorage.getItem('rt') } }).catch(() => null); clearSession(); window.location.href = '/login' }

  return (
    <AppCtx.Provider value={{ user, pid, setPid, patients, perms, can: (p: string) => perms.includes(p), unread, setUnread, reloadUser: loadUser, rev, bump: () => setRev((x) => x + 1), viewingOther, viewing: viewingOther ? link.patient : user }}>
      <nav className="bg-blue-900 text-white p-3 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <b>MedMinder</b>
        {nav.map(([h, l]) => <Link key={h} href={h} className={path === h ? 'underline font-bold' : ''}>{l}</Link>)}
        {isMember && (
          <select className="text-black p-1 rounded" value={pid} onChange={(e) => setPid(e.target.value)}>
            {patients.map((p) => <option key={p.patient.id} value={p.patient.id}>Viewing: {p.patient.name}</option>)}
            <option value="me">Viewing: my own data</option>
          </select>
        )}
        <span className="ml-auto">{user.name} ({user.role.toLowerCase()})</span>
        <button onClick={logout} className="underline">Log out</button>
      </nav>
      {toast && <div className="bg-yellow-200 p-2 text-center">{toast}</div>}
      {viewingOther && (
        <div className={`p-2 text-center text-sm ${perms.includes('edit') ? 'bg-green-100' : 'bg-gray-200'}`}>
          You are viewing <b>{link.patient.name}</b>&apos;s data. {perms.includes('edit') ? 'You can edit it on their behalf; they will be notified of every change.' : 'View only - the patient has not allowed you to edit (they can switch this on under Care team).'}
        </div>
      )}
      {isMember && !viewingOther && patients.length === 0 && user.role === 'DOCTOR' && <div className="bg-yellow-100 p-2 text-center text-sm">No patients linked yet. Accept an invitation under <Link className="underline" href="/care">Care team</Link>, or request access to a patient there.</div>}
      <main className="max-w-5xl mx-auto p-4">{children}</main>
    </AppCtx.Provider>
  )
}
