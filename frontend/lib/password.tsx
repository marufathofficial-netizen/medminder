'use client'
import { useState } from 'react'

export const RULES: [string, (p: string) => boolean][] = [
  ['At least 8 characters', (p) => p.length >= 8],
  ['At least 1 uppercase letter', (p) => /[A-Z]/.test(p)],
  ['At least 1 lowercase letter', (p) => /[a-z]/.test(p)],
  ['At least 1 special character (e.g. ! @ # $ %)', (p) => /[^A-Za-z0-9\s]/.test(p)],
]
export const passwordOk = (p: string) => RULES.every(([, f]) => f(p))

const pick = (chars: string) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return chars[a[0] % chars.length] }
/** Random strong password (16 chars) using the browser's secure random generator. Different every time. */
export function generatePassword(len = 16) {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', S = '!@#$%^&*?-_+='
  const out = [pick(U), pick(L), pick(D), pick(S)]
  while (out.length < len) out.push(pick(U + L + D + S))
  for (let i = out.length - 1; i > 0; i--) { const a = new Uint32Array(1); crypto.getRandomValues(a); const j = a[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out.join('')
}

export function PasswordField({ value, onChange, label = 'Password', allowGenerate = true }: { value: string; onChange: (v: string) => void; label?: string; allowGenerate?: boolean }) {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const gen = () => { onChange(generatePassword()); setShow(true); setCopied(false) }
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) } }
  return (
    <div>
      <label>{label}</label>
      <input className="in" type={show ? 'text' : 'password'} required autoComplete="new-password" value={value} onChange={(e) => { onChange(e.target.value); setCopied(false) }} />
      <ul className="text-sm mb-2">
        {RULES.map(([t, f]) => <li key={t}>{f(value) ? '✔' : '✘'} {t}</li>)}
      </ul>
      <button type="button" className="btn2" onClick={() => setShow(!show)}>{show ? 'Hide password' : 'Show password'}</button>
      {allowGenerate && <button type="button" className="btn2" onClick={gen}>Generate strong password</button>}
      {value && show && <button type="button" className="btn2" onClick={copy}>{copied ? 'Copied' : 'Copy password'}</button>}
      {allowGenerate && <p className="text-sm">Generated passwords are unique each time. Copy it and keep it somewhere safe before you continue.</p>}
    </div>
  )
}
