export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
export function dateInZone(date = new Date(), zone = localZone()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function daysUntil(value: string, today: string) {
  return Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)
}
export const timeLabel = (value: string, zone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
export const shortDate = (value: string) => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '未填写'
