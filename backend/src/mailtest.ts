import 'dotenv/config'
import { Mailer } from './common'
;(async () => {
  const to = process.argv[2]
  if (!to) throw new Error('Usage: npm run mailtest -- you@example.com')
  const m = new Mailer()
  await m.onModuleInit()
  await m.send(to, 'MedMinder test email', 'If you can read this, real email sending works.')
  console.log('Sent to', to)
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
