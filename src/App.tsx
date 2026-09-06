import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, ArrowRight, Bell, CalendarBlank, CaretRight, Check, ClockCounterClockwise, GearSix, Heart, Info, ListChecks, Pill, SignOut, Sparkle, WarningCircle, X } from '@phosphor-icons/react'
import { api, ApiError, messageOf, post } from './api'
import { addDays, dateInZone, localZone } from './dates'
import { demoData } from './demo'
import { Dashboard } from './Dashboard'
import { MedicineCabinet, History, Settings } from './OtherPages'
import { AuthModal } from './AuthModal'
import { MedicationForm } from './MedicationForm'
import { Modal } from './Modal'
import { usePush } from './usePush'
import type { Config, Medication, MedicationInput, MedicationRecord, Occurrence, Page, Status, User } from './types'

const navigation = [
  { id: 'today' as Page, label: '今日提醒', icon: ListChecks },
  { id: 'medications' as Page, label: '我的药箱', icon: Pill },
  { id: 'history' as Page, label: '服药记录', icon: ClockCounterClockwise },
  { id: 'settings' as Page, label: '提醒设置', icon: GearSix },
]
export default function App() {
  const [page, setPage] = useState<Page>('today')
  const [user, setUser] = useState<User | null>(null)
  const [config, setConfig] = useState<Config>({ aiEnabled: false, pushEnabled: false, vapidPublicKey: '' })
  const [booting, setBooting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [medications, setMedications] = useState<Medication[]>([])
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [records, setRecords] = useState<MedicationRecord[]>([])
  const [now, setNow] = useState(new Date())
  const today = dateInZone(now, user?.timeZone || localZone())
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [authOpen, setAuthOpen] = useState(false)
  const [form, setForm] = useState<Medication | 'new' | null>(null)
  const [archive, setArchive] = useState<Medication | null>(null)
  const [action, setAction] = useState<{ occurrence: Occurrence; status: Status } | null>(null)
  const [busyId, setBusyId] = useState('')
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const epoch = useRef(0)
  const refreshId = useRef(0)
  const previousToday = useRef(today)
  const notify = useCallback((text: string, isError = false) => setToast({ text, error: isError }), [])
  const login = useCallback(() => setAuthOpen(true), [])
  const push = usePush(user, config, notify, login)
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id) } }, [toast])
  useEffect(() => {
    let active = true
    Promise.allSettled([api<User>('/auth/me'), api<Config>('/config')]).then(results => {
      if (!active) return
      if (results[0].status === 'fulfilled') setUser(results[0].value)
      else if (!(results[0].reason instanceof ApiError && results[0].reason.status === 401)) setError(messageOf(results[0].reason))
      if (results[1].status === 'fulfilled') setConfig(results[1].value)
      setBooting(false)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (today !== previousToday.current) {
      if (date === previousToday.current) setDate(today)
      setTo(today); previousToday.current = today
    }
  }, [today, date])
  const refresh = useCallback(async (quiet = false) => {
    if (!user) return
    const current = epoch.current
    const request = ++refreshId.current
    if (!quiet) setLoading(true)
    try {
      const [meds, doses, history] = await Promise.all([
        api<Medication[]>('/medications'), api<Occurrence[]>(`/today?date=${date}`),
        api<MedicationRecord[]>(`/records?from=${from}&to=${to}`),
      ])
      if (current !== epoch.current || request !== refreshId.current) return
      setMedications(meds); setOccurrences(doses); setRecords(history); setError('')
    } catch (error) {
      if (current !== epoch.current || request !== refreshId.current) return
      if (error instanceof ApiError && error.status === 401) {
        epoch.current++; setUser(null); setMedications([]); setOccurrences([]); setRecords([])
        notify('登录已过期，请重新登录。', true); setAuthOpen(true)
      } else setError(messageOf(error))
    } finally { if (request === refreshId.current) setLoading(false) }
  }, [user, date, from, to, notify])
  useEffect(() => {
    void refresh()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void refresh(true) }, 30000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh(true) }
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  const preview = demoData(date)
  const isDemo = !user
  const viewMeds = isDemo ? demoData(today).medications : medications
  const viewDoses = isDemo ? preview.occurrences : occurrences
  const viewRecords = isDemo ? preview.records.filter(r => r.date >= from && r.date <= to) : records
  const pending = viewDoses.filter(o => ['pending', 'snoozed'].includes(o.status)).length
  const due = user && date === today ? occurrences.filter(o => ['pending', 'snoozed'].includes(o.status) && new Date(o.snoozedUntil || o.scheduledAt).getTime() <= now.getTime()) : []
  function navigate(next: Page) { setPage(next); window.scrollTo({ top: 0 }) }
  function add() { if (!user) { login(); return } setForm('new') }
  function edit(m: Medication) { if (!user) { login(); return } setForm(m) }
  async function save(data: MedicationInput, id?: string) {
    await api(`/medications${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })
    setForm(null); await refresh(); notify(id ? '药品与提醒计划已更新。' : '药品已加入药箱，提醒计划已建立。')
  }
  function record(o: Occurrence, status: Status) {
    if (!user) { login(); return }
    setAction({ occurrence: o, status })
  }
  async function confirmAction() {
    if (!action) return
    const { occurrence: o, status } = action
    setBusyId(o.id)
    try {
      await post('/records', { medicationId: o.medicationId, date: o.date, time: o.time, status })
      setAction(null); await refresh(true)
      notify(status === 'taken' ? '已记录这次服用，好好照顾自己。' : status === 'snoozed' ? '已延后 15 分钟，届时再次提醒。' : '已记录跳过本次服用。')
    } catch (error) { notify(messageOf(error), true) } finally { setBusyId('') }
  }
  async function confirmArchive() {
    if (!archive) return
    setBusyId(archive.id)
    try {
      await api(`/medications/${archive.id}`, { method: 'DELETE' })
      setArchive(null); await refresh(); notify('药品已归档，历史服药记录已保留。')
    } catch (error) { notify(messageOf(error), true) } finally { setBusyId('') }
  }
  async function logout() {
    try {
      // Remove this device's subscription before clearing the authenticated session.
      if ('serviceWorker' in navigator && window.isSecureContext) {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager?.getSubscription()
        if (sub) { await post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe() }
      }
      await post('/auth/logout')
      epoch.current++; setUser(null); setMedications([]); setRecords([]); setOccurrences([]); setError(''); setPage('today'); notify('已退出登录。')
    } catch (error) { notify(messageOf(error), true) }
  }
  const pageLabel = navigation.find(n => n.id === page)?.label
  return <div className="app-layout">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('today') }}><span className="brand-icon"><Pill size={27} weight="duotone" /></span><span><strong>服药提醒智能体</strong><small>YOUR DAILY CARE</small></span></a><div className="sidebar-section-label">我的健康空间</div><nav aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={21} weight={page === id ? 'fill' : 'regular'} /><span>{label}</span>{id === 'today' && pending > 0 && <small>{pending}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="care-note"><span><Heart size={19} weight="duotone" /> 给自己的小关怀</span><p>规律一点，安心多一点。<br />健康，藏在每天的小事里。</p><i /></div><button className="help-button" onClick={() => setHelpOpen(true)}><Info size={18} /> 使用帮助<CaretRight size={15} /></button><div className="sidebar-account"><button onClick={() => user ? navigate('settings') : login()}><span className="account-avatar">{user ? (user.name || user.email).slice(0, 1).toUpperCase() : '你'}</span><span><strong>{user?.name || '开启我的健康计划'}</strong><small>{user ? '个人健康空间' : '登录 / 注册账户'}</small></span></button>{user && <button className="icon-button" aria-label="退出登录" onClick={logout}><SignOut size={18} /></button>}</div></div></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><span className="mobile-brand"><Pill size={23} weight="duotone" /></span><span>健康空间</span><CaretRight size={13} /><strong>{pageLabel}</strong></div><div className="topbar-right"><span className="today-date"><CalendarBlank size={17} />{new Intl.DateTimeFormat('zh-CN', { timeZone: user?.timeZone || localZone(), month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</span><button className="notification-button icon-button" aria-label="通知设置" onClick={() => navigate('settings')}><Bell size={20} />{push.status === 'enabled' && <i />}</button>{!user && <button className="login-button" onClick={login}>登录 / 注册<ArrowRight size={14} /></button>}</div></header>
      <main>
        {isDemo && !booting && <div className="demo-banner"><span><Sparkle size={16} />正在预览示例空间 · 数据仅用于展示，不是用药建议</span><button onClick={login}>建立我的计划<ArrowRight size={15} /></button></div>}
        {error && <div className="error-banner" role="alert"><WarningCircle size={20} /><span>{error}</span><button className="text-button" onClick={() => user ? void refresh() : window.location.reload()}><ArrowClockwise size={17} />重试</button></div>}
        {due.length > 0 && <div className="due-banner" role="status"><Bell size={19} weight="duotone" /><span>你有 {due.length} 次已到时间的服药计划，请核对实际情况并记录。</span><button className="text-button" onClick={() => { navigate('today'); setDate(today) }}>查看计划<ArrowRight size={16} /></button></div>}
        {booting || loading && !medications.length ? <div className="loading-view" role="status" aria-label="正在加载健康空间"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-banner" /><div className="skeleton skeleton-list" /><p>正在整理你的健康空间…</p></div> : <>
          {page === 'today' && <Dashboard user={user} today={today} date={date} onDate={setDate} medications={viewMeds} occurrences={viewDoses} onAdd={add} onAction={record} onNavigate={navigate} busyId={busyId} onEdit={edit} isDemo={isDemo} />}
          {page === 'medications' && <MedicineCabinet medications={viewMeds} today={today} onAdd={add} onEdit={edit} onArchive={m => user ? setArchive(m) : login()} />}
          {page === 'history' && <History records={viewRecords} from={from} to={to} onRange={(start, end) => { setFrom(start); setTo(end) }} zone={user?.timeZone || localZone()} isDemo={isDemo} />}
          {page === 'settings' && <Settings user={user} config={config} pushStatus={push.status} pushBusy={push.busy} onEnablePush={push.enable} onDisablePush={push.disable} onTestPush={push.test} onLogin={login} onLogout={logout} />}
        </>}
        <footer className="site-footer"><span><Heart size={13} /> 用心记得，为你安心</span><span>服药提醒智能体 · 仅作提醒与记录</span></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={23} weight={page === id ? 'fill' : 'regular'} /><span>{label}</span></button>)}</nav>
    {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSuccess={u => { epoch.current++; setUser(u); setAuthOpen(false); setDate(dateInZone(new Date(), u.timeZone)); setError(''); notify('欢迎，开始你的安心计划。') }} />}
    {form && <MedicationForm existing={form === 'new' ? undefined : form} today={today} aiEnabled={config.aiEnabled} onClose={() => setForm(null)} onSave={save} />}
    {archive && <Modal title="归档这份药品？" subtitle="归档后停止后续提醒，已有服药记录会保留。" onClose={() => !busyId && setArchive(null)}><p className="confirm-medicine">{archive.name}</p><div className="modal-footer"><button className="button secondary" disabled={!!busyId} onClick={() => setArchive(null)}>暂不归档</button><button className="button primary" disabled={!!busyId} onClick={confirmArchive}>{busyId ? '正在归档…' : '确认归档'}</button></div></Modal>}
    {action && <Modal title={action.status === 'taken' ? '确认已服用本次药品' : action.status === 'snoozed' ? '15 分钟后再提醒' : '确认跳过本次服用'} subtitle={`${action.occurrence.date} ${action.occurrence.time} · ${action.occurrence.medication.name}`} onClose={() => !busyId && setAction(null)}><p className="confirm-medicine">{action.occurrence.medication.dose}</p><p className="muted">{action.status === 'taken' ? '请确认你已实际服用。本次记录保存后将标记为已完成。' : action.status === 'snoozed' ? '仅延后提醒时间，不代表可以改变医嘱。系统通知需事先开启。' : '本次会记录为已跳过，不再发送本次提醒。补服问题请咨询医生或药师。'}</p>{action.occurrence.medication.expiryDate && action.occurrence.medication.expiryDate < today && <p className="info-note"><WarningCircle size={19} />此药品已过期，请核对并联系药师；不要因提醒而服用过期药品。</p>}<div className="modal-footer"><button className="button secondary" disabled={!!busyId} onClick={() => setAction(null)}>返回</button><button className="button primary" disabled={!!busyId} onClick={confirmAction}>{busyId ? '正在记录…' : action.status === 'taken' ? '确认已服用' : action.status === 'snoozed' ? '确认延后' : '确认跳过'}<Check size={17} /></button></div></Modal>}
    {helpOpen && <Modal title="给你的使用小指南" subtitle="三个步骤，建立自己的服药提醒。" onClose={() => setHelpOpen(false)}><ol className="help-list"><li><strong>建立你的药箱</strong><p>登录后拍照或手动添加药品，核对名称、规格与有效期。</p></li><li><strong>确认服用计划</strong><p>按医嘱填写用量和每日提醒时间，并在设置中开启设备通知。</p></li><li><strong>记录实际情况</strong><p>服用后点击“已服用”；也可以延后 15 分钟或跳过，并在记录页回顾。</p></li></ol><p className="info-note">网页关闭后的提醒依赖系统推送及网络，不保证离线或关机时送达。应用不提供诊断、剂量建议或补服建议。</p><button className="button primary full" onClick={() => setHelpOpen(false)}>知道了<Check size={18} /></button></Modal>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <WarningCircle size={21} /> : <Check size={21} />}<span>{toast.text}</span><button className="icon-button" aria-label="关闭消息" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>
}
