import { genDoses } from './common'

describe('genDoses', () => {
  const m = { startDate: new Date('2026-01-01T00:00:00Z'), endDate: null, schedule: { type: 'DAILY', times: ['08:00', '20:00'] } }
  it('creates two doses per day in the patient timezone', () => {
    const r = genDoses(m, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T23:59:00Z'), 'UTC')
    expect(r.length).toBe(4)
  })
  it('respects weekday schedules', () => {
    const w = { ...m, schedule: { type: 'DAYS', times: ['09:00'], days: [1] } }
    const r = genDoses(w, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-14T00:00:00Z'), 'UTC')
    expect(r.every((d) => d.getUTCDay() === 1)).toBe(true)
  })
})
