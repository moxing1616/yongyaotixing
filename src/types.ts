export type Page = 'today' | 'medications' | 'history' | 'settings'
export type Status = 'pending' | 'taken' | 'snoozed' | 'skipped'
export type Color = 'sage' | 'amber' | 'blue' | 'rose'
export interface User { id: string; email: string; name: string; timeZone: string }
export interface Medication {
  id: string; name: string; specification: string; expiryDate: string; instructions: string;
  dose: string; times: string[]; startDate: string; endDate: string; notes: string;
  color: Color; active: boolean; createdAt: string;
}
export type MedicationInput = Omit<Medication, 'id' | 'active' | 'createdAt'>
export interface Occurrence {
  id: string; medicationId: string; date: string; time: string; scheduledAt: string;
  status: Status; snoozedUntil: string | null; medication: Medication;
}
export interface MedicationRecord {
  id: string; medicationId: string; medicationName: string; dose: string;
  date: string; time: string; status: Status; recordedAt: string; snoozedUntil: string | null;
}
export interface Config { aiEnabled: boolean; pushEnabled: boolean; vapidPublicKey: string }
export interface Recognition {
  name: string; specification: string; expiryDate: string; instructions: string; warnings: string[];
}
