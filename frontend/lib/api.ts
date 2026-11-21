export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
export const setSession = (s: any) => { localStorage.setItem('at', s.accessToken); localStorage.setItem('rt', s.refreshToken) }
export const clearSession = () => { localStorage.removeItem('at'); localStorage.removeItem('rt') }

let refreshing: Promise<boolean> | null = null
async function refresh() {
  const rt = localStorage.getItem('rt')
  if (!rt) return false
  const r = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
  if (!r.ok) return false
  setSession(await r.json())
  return true
}

export async function api(path: string, o: { method?: string; body?: any; raw?: boolean; form?: FormData } = {}): Promise<any> {
  const go = () => fetch(API + path, {
    method: o.method || (o.body !== undefined || o.form ? 'POST' : 'GET'),
    headers: { ...(o.form ? {} : { 'Content-Type': 'application/json' }), Authorization: 'Bearer ' + (localStorage.getItem('at') || '') },
    body: o.form || (o.body !== undefined ? JSON.stringify(o.body) : undefined),
  })
  let r = await go()
  if (r.status === 401 && !path.startsWith('/auth/')) {
    refreshing = refreshing || refresh().finally(() => { refreshing = null })
    if (await refreshing) r = await go()
    else { clearSession(); if (typeof window !== 'undefined') window.location.href = '/login' }
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(Array.isArray(e.message) ? e.message.join(', ') : e.message || r.statusText)
  }
  return o.raw ? r : r.json()
}

export async function download(path: string, filename: string) {
  const r = await api(path, { raw: true })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(await r.blob())
  a.download = filename
  a.click()
}

export const ALL_PERMS = ['meds', 'adherence', 'journal', 'measurements', 'documents', 'edit', 'prescribe']
export const fmt = (d: any) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
export const fmtT = (d: any) => new Date(d).toLocaleTimeString([], { timeStyle: 'short' })
export const ymd = (d: Date) => d.toLocaleDateString('en-CA')
