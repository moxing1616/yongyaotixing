export interface User {
  id: string;
  email: string;
  name: string;
  timeZone: string;
}

export interface AuthResult {
  user: User;
  accessToken: string;
  expiresAt: string;
}

export interface MedicationInput {
  name: string;
  specification: string;
  expiryDate: string;
  instructions: string;
  dose: string;
  times: string[];
  startDate: string;
  endDate: string;
  notes: string;
  color: string;
}

export interface Medication extends MedicationInput {
  id: string;
  active: boolean;
  createdAt: string;
}

export interface Occurrence {
  id: string;
  medicationId: string;
  date: string;
  time: string;
  scheduledAt: string;
  status: string;
  snoozedUntil: string | null;
  medication: Medication;
}

export interface MedicationRecord {
  id: string;
  medicationId: string;
  medicationName: string;
  dose: string;
  date: string;
  time: string;
  status: string;
  recordedAt: string;
  snoozedUntil: string | null;
}

export interface Recognition {
  name: string;
  specification: string;
  expiryDate: string;
  instructions: string;
  warnings: string[];
}

export interface ServerConfig {
  aiEnabled: boolean;
  pushEnabled: boolean;
  vapidPublicKey: string;
}

export interface ReminderItem {
  key: string;
  kind: string;
  title: string;
  body: string;
  at: string;
  medicationId: string;
  date: string;
  time: string;
}

export interface ReminderPlan {
  generatedAt: string;
  timeZone: string;
  items: ReminderItem[];
  total: number;
  hasMore: boolean;
}

export function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function emptyMedication(): MedicationInput {
  return {
    name: '', specification: '', expiryDate: '', instructions: '', dose: '',
    times: ['08:00'], startDate: dateText(new Date()), endDate: '', notes: '', color: 'sage'
  };
}

export function statusText(status: string): string {
  if (status === 'taken') return '已服用';
  if (status === 'skipped') return '已跳过';
  if (status === 'snoozed') return '已延后';
  return '待服用';
}

export function errorMessage(error: Error): string {
  return error.message || '操作未完成，请稍后重试。';
}
