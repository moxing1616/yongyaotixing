import type { Medication, Occurrence, MedicationRecord } from './types'
import { addDays } from './dates'

export function demoData(today: string) {
  const medications: Medication[] = [
    { id: 'demo-1', name: '维生素 C 片', specification: '100 mg × 60片', dose: '每次 1 片', times: ['08:00', '19:00'], color: 'amber', expiryDate: addDays(today, 240), notes: '按个人已确认的计划', instructions: '此处为界面示例，不构成用药建议。', startDate: addDays(today, -6), endDate: '', active: true, createdAt: today },
    { id: 'demo-2', name: '碳酸钙 D₃ 片', specification: '600 mg × 30片', dose: '每次 1 片', times: ['12:30'], color: 'sage', expiryDate: addDays(today, 25), notes: '按个人已确认的计划', instructions: '此处为界面示例，不构成用药建议。', startDate: addDays(today, -6), endDate: '', active: true, createdAt: today },
    { id: 'demo-3', name: '维生素 B 族片', specification: '0.5 g × 60片', dose: '每次 1 片', times: ['20:00'], color: 'rose', expiryDate: addDays(today, 360), notes: '', instructions: '此处为界面示例，不构成用药建议。', startDate: addDays(today, -6), endDate: '', active: true, createdAt: today },
  ]
  const occurrences: Occurrence[] = medications.flatMap(medication => medication.times.map(time => ({
    id: `${medication.id}:${today}:${time}`, medicationId: medication.id, date: today, time,
    scheduledAt: new Date(`${today}T${time}:00`).toISOString(), status: time === '08:00' ? 'taken' as const : 'pending' as const,
    snoozedUntil: null, medication,
  }))).sort((a, b) => a.time.localeCompare(b.time))
  const records: MedicationRecord[] = occurrences.filter(o => o.status === 'taken').map(o => ({
    id: o.id, medicationId: o.medicationId, medicationName: o.medication.name, dose: o.medication.dose,
    date: today, time: o.time, status: o.status, recordedAt: o.scheduledAt, snoozedUntil: null,
  }))
  return { medications, occurrences, records }
}
