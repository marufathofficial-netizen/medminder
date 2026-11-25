'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, fmt } from '@/lib/api'
import { useApp, useRun } from '@/lib/ui'

export default function Notifications() {
  const { setUnread, rev, reloadUser } = useApp()
  const [items, setItems] = useState<any[]>([])
  const { run, Msg } = useRun()
  const load = async () => { const r = await api('/notifications?limit=100'); setItems(r.items); setUnread(r.unread) }
  useEffect(() => { load() }, [rev])
  const readAll = () => run(async () => { await api('/notifications/read', { body: {} }); load() })
  const act = (n: any, a: string) => run(async () => {
    const b = `/patients/me/doses/${n.data.doseId}`
    if (a === 'snooze') await api(`${b}/snooze`, { body: { minutes: 15 } })
    else await api(`${b}/log`, { body: { status: a } })
    await api('/notifications/read', { body: { ids: [n.id] } }); load()
    return 'Done'
  })
  return (
    <>
      <h1>Notification center</h1>
      {Msg}
      <button className="btn" onClick={readAll}>Mark all as read</button>
      {items.map((n) => (
        <div key={n.id} className={`card mt-3 ${n.read ? 'opacity-70' : 'border-blue-600 border-2'}`}>
          <b>{n.title}</b> {!n.read && <span className="bg-blue-700 text-white text-xs px-2 rounded">new</span>}
          <p>{n.body}</p><p className="text-sm text-gray-600">{fmt(n.createdAt)}</p>
          {n.type === 'LINK_INVITE' && <Link className="underline" href="/care">Open Care team to accept</Link>}
          {n.type === 'RX_VERIFY' && <Link className="underline" href="/prescriptions">Review prescription</Link>}
          {n.data?.doseId && !n.read && <div><button className="btn" onClick={() => act(n, 'TAKEN')}>Taken</button><button className="btn2" onClick={() => act(n, 'snooze')}>Snooze 15m</button><button className="btn2" onClick={() => act(n, 'SKIPPED')}>Skip</button></div>}
          {!n.read && <button className="btn2" onClick={() => run(async () => { await api('/notifications/read', { body: { ids: [n.id] } }); load() })}>Mark read</button>}
        </div>
      ))}
      {!items.length && <p className="mt-3">No notifications yet.</p>}
    </>
  )
}
