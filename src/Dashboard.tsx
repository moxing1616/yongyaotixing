import { useState } from 'react'
import { ArrowRight, Bell, CalendarBlank, Camera, Check, CheckCircle, Clock, DotsThree, FlowerLotus, Leaf, Pill, Plus, ShieldCheck, SkipForward, Sparkle, Sun, WarningCircle } from '@phosphor-icons/react'
import type { Medication, Occurrence, Status, User, Page } from './types'
import { addDays, dateInZone, daysUntil, shortDate, timeLabel } from './dates'

export function PillArt({ small = false }: { small?: boolean }) {
  return <div className={`pill-art ${small ? 'small' : ''}`} aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-star"><Sparkle size={22} weight="fill" /></div><div className="pill-shape"><span /><i /></div><div className="pill-round"><span /></div><div className="art-leaf"><Leaf size={42} weight="duotone" /></div><div className="art-check"><Check size={17} weight="bold" /></div></div>
}

export function MedicationIcon({ medication, size = 25 }: { medication: Medication; size?: number }) {
  return <span className={`medication-icon ${medication.color}`}><Pill size={size} weight="duotone" /></span>
}

export function Dashboard({ user, today, date, onDate, medications, occurrences, onAdd, onAction, onNavigate, busyId, onEdit, isDemo }: {
  user: User | null; today: string; date: string; onDate: (date: string) => void; medications: Medication[]; occurrences: Occurrence[];
  onAdd: () => void; onAction: (occurrence: Occurrence, status: Status) => void; onNavigate: (page: Page) => void;
  busyId: string; onEdit: (medication: Medication) => void; isDemo: boolean;
}) {
  const [filter, setFilter] = useState('all')
  const taken = occurrences.filter(o => o.status === 'taken').length
  const pending = occurrences.filter(o => ['pending', 'snoozed'].includes(o.status)).length
  const expiring = medications.filter(m => m.expiryDate && daysUntil(m.expiryDate, today) <= 30).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
  const percentage = occurrences.length ? Math.round(taken / occurrences.length * 100) : 0
  const visible = occurrences.filter(o => filter === 'all' || (filter === 'pending' ? ['pending', 'snoozed'].includes(o.status) : ['taken', 'skipped'].includes(o.status)))
  const weekDay = new Date(`${date}T12:00:00`).getDay()
  const monday = addDays(date, -(weekDay === 0 ? 6 : weekDay - 1))
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-dot" /> 每一份健康，都值得用心</div><h1>{user ? `${user.name || '朋友'}，` : ''}好好照顾自己<span className="heading-dot">。</span></h1><p>把按时服药的小事，交给一个贴心的提醒。</p></div><button className="button primary add-top" onClick={onAdd}><Plus size={19} />添加药品</button></div>
    <section className="welcome-banner">
      <div className="banner-copy"><span className="capsule-label"><Sun size={16} weight="duotone" /> YOUR DAILY CARE</span><h2>按时的一小步，<br />安心的一整天。</h2><p>{occurrences.length ? <>已记录 {taken} 次服用{pending ? `，还有 ${pending} 次等待你确认。` : '，谢谢你认真照顾自己。'}</> : '从添加第一种药品开始，建立你的安心计划。'}</p><button className="text-button" onClick={() => document.getElementById('daily-plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>查看服药计划 <ArrowRight size={17} /></button></div>
      <PillArt />
      <div className="banner-note"><ShieldCheck size={15} /> 记得每一次，安心每一天</div>
    </section>
    <div className="stats-strip">
      <div><span className="stat-icon sage"><CalendarBlank size={22} /></span><section><p>当日服药计划</p><strong>{occurrences.length}<small>次</small></strong></section></div>
      <div><span className="stat-icon sage"><CheckCircle size={22} /></span><section><p>已经服用</p><strong>{taken}<small>次</small></strong></section></div>
      <div><span className="stat-icon amber"><Clock size={22} /></span><section><p>等待确认</p><strong>{pending}<small>次</small></strong></section></div>
      <button onClick={() => onNavigate('medications')}><span className="stat-icon rose"><WarningCircle size={22} /></span><section><p>临期 / 已过期</p><strong>{expiring.length}<small>种</small></strong></section><ArrowRight className="stat-arrow" size={16} /></button>
    </div>
    <div className="dashboard-grid"><section className="daily-panel panel" id="daily-plan">
      <div className="section-heading"><div className="title-inline"><h2>{date === today ? '今日服药计划' : `${shortDate(date)}的计划`}</h2><span className="count-badge">{occurrences.length}</span></div><button className="text-button muted" onClick={() => onDate(today)}><CalendarBlank size={17} />{date === today ? shortDate(date) : '回到今天'}</button></div>
      <div className="week-strip">{Array.from({ length: 7 }, (_, i) => { const value = addDays(monday, i); return <button key={value} className={`${value === date ? 'selected' : ''} ${value === today ? 'is-today' : ''}`} onClick={() => onDate(value)} aria-label={`查看${value}服药计划`} aria-pressed={value === date}><small>{['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]}</small><strong>{Number(value.slice(8))}</strong><span>{value === today ? '今天' : '·'}</span></button> })}</div>
      <div className="list-toolbar"><div className="tabs">{[['all', '全部'], ['pending', '待服用'], ['done', '已处理']].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={filter === key ? 'active' : ''} aria-pressed={filter === key}>{label}</button>)}</div><span className="list-hint"><span className="tiny-dot" />按时间排序</span></div>
      <div className="dose-list">{visible.length ? visible.map(o => <DoseRow key={o.id} occurrence={o} today={today} zone={user?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone} onAction={onAction} busy={busyId === o.id} onEdit={onEdit} />) : <div className="empty-state"><FlowerLotus size={42} weight="duotone" /><h3>{filter === 'all' ? '这一天，还没有服药计划' : '这里暂时没有记录'}</h3><p>{filter === 'all' ? '添加药品和提醒时间，我们会为你整理在这里。' : '切换列表，查看其他服药安排。'}</p>{filter === 'all' && <button className="button secondary" onClick={onAdd}><Plus size={17} />添加第一种药品</button>}</div>}</div>
      <div className="panel-footnote"><ShieldCheck size={15} /> 请按医嘱用药，漏服后如何处理请咨询医生或药师。</div>
    </section><aside className="right-column">
      <section className="scan-card"><div className="scan-header"><span className="icon-tile"><Sparkle size={23} weight="duotone" /></span><span className="ai-badge">AI 助手</span></div><h3>药盒拍一下，<br />信息轻松记。</h3><p>自动提取药品名称、规格与有效期，核对后即可设置提醒。</p><button className="button primary full" onClick={onAdd}><Camera size={18} />拍照添加药品<ArrowRight size={17} /></button><small>识别结果由你确认，更安心</small></section>
      <section className="panel progress-panel"><div className="section-heading"><h3>当日服用进度</h3><Leaf size={19} /></div><div className="progress-content"><div className="progress-ring" style={{ '--progress': `${percentage}%` } as React.CSSProperties}><span><strong>{percentage}<small>%</small></strong></span></div><div><strong>{taken} / {occurrences.length} 次</strong><p>每一次记录，<br />都是对自己的关心。</p></div></div>{isDemo && <span className="demo-inline">界面示例数据</span>}</section>
      <section className="panel expiry-panel"><div className="section-heading"><h3><Bell size={18} /> 药品保质期</h3><button className="icon-button" aria-label="查看药箱" onClick={() => onNavigate('medications')}><ArrowRight size={18} /></button></div>{expiring.length ? expiring.slice(0, 2).map(m => <button key={m.id} className="expiry-item" onClick={() => onEdit(m)}><MedicationIcon medication={m} size={21} /><div><strong>{m.name}</strong><p>{daysUntil(m.expiryDate, today) < 0 ? '已过期，请核查' : `距到期 ${daysUntil(m.expiryDate, today)} 天`}</p></div><span className="expiry-dot" /></button>) : <p className="quiet-state"><ShieldCheck size={20} />{medications.length ? '暂无已填写有效期的临期药品' : '添加有效期，提前收到提醒'}</p>}<p className="field-help">到期前 30 天开始提醒</p></section>
    </aside></div>
  </>
}

function DoseRow({ occurrence: o, today, zone, onAction, busy, onEdit }: { occurrence: Occurrence; today: string; zone: string; onAction: (o: Occurrence, status: Status) => void; busy: boolean; onEdit: (m: Medication) => void }) {
  const done = o.status === 'taken' || o.status === 'skipped'
  const expired = o.medication.expiryDate && o.medication.expiryDate < today
  const overdue = !done && new Date(o.snoozedUntil || o.scheduledAt).getTime() < Date.now()
  return <article className={`dose-row ${done ? 'done' : ''}`}>
    <div className="dose-time"><strong>{o.time}</strong><span>{o.date !== today ? shortDate(o.date) : Number(o.time.slice(0, 2)) < 12 ? '上午' : Number(o.time.slice(0, 2)) < 18 ? '下午' : '晚上'}</span></div>
    <MedicationIcon medication={o.medication} />
    <div className="dose-description"><div><h3>{o.medication.name}</h3>{o.status === 'taken' && <span className="status-label taken"><CheckCircle size={13} weight="fill" />已服用</span>}{o.status === 'skipped' && <span className="status-label">已跳过</span>}{o.status === 'snoozed' && <span className="status-label snoozed">已延后</span>}{o.status === 'pending' && overdue && <span className="status-label waiting">待记录</span>}</div><p>{o.medication.dose}<span>·</span>{o.medication.specification || '未填写规格'}</p>{o.snoozedUntil && !done ? <small className="snooze-text">延后至 {shortDate(dateInZone(new Date(o.snoozedUntil), zone))} {timeLabel(o.snoozedUntil, zone)}</small> : <small>{expired ? '药品已过期，请核对并联系药师' : o.medication.notes || '按照已确认的服用计划'}</small>}</div>
    <div className="dose-actions">{done ? <span className="done-icon">{o.status === 'taken' ? <Check size={23} /> : <SkipForward size={23} />}</span> : o.date > today ? <span className="future-label">尚未到日期</span> : <><button className="button take-button" disabled={busy} onClick={() => onAction(o, 'taken')}><Check size={16} />{busy ? '保存中' : '已服用'}</button><div className="secondary-actions"><button disabled={busy} onClick={() => onAction(o, 'snoozed')} title="15 分钟后再提醒"><Clock size={13} />延后</button><button disabled={busy} onClick={() => onAction(o, 'skipped')}>跳过</button></div></> }<button className="row-more icon-button" aria-label={`查看${o.medication.name}详情`} onClick={() => onEdit(o.medication)}><DotsThree size={20} /></button></div>
  </article>
}
