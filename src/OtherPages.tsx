import { useState } from 'react'
import { Archive, ArrowRight, Bell, BellRinging, CalendarBlank, CheckCircle, Clock, DownloadSimple, EnvelopeSimple, Globe, LockKey, MagnifyingGlass, PencilSimple, Pill, Plus, ShieldCheck, DeviceMobile as Smartphone, Sparkle, WarningCircle } from '@phosphor-icons/react'
import type { Config, Medication, MedicationRecord, User } from './types'
import { daysUntil, shortDate, timeLabel } from './dates'
import { MedicationIcon } from './Dashboard'

export function MedicineCabinet({ medications, today, onAdd, onEdit, onArchive }: {
  medications: Medication[]; today: string; onAdd: () => void; onEdit: (m: Medication) => void; onArchive: (m: Medication) => void;
}) {
  const [query, setQuery] = useState('')
  const [onlyExpiring, setOnlyExpiring] = useState(false)
  const visible = medications.filter(m => m.name.toLowerCase().includes(query.toLowerCase()) && (!onlyExpiring || m.expiryDate && daysUntil(m.expiryDate, today) <= 30))
  return <>
    <div className="page-heading"><div><div className="eyebrow">MY MEDICINE CABINET</div><h1>我的药箱<span className="heading-dot">。</span></h1><p>药品、服用计划和有效期，都有条有理。</p></div><button className="button primary" onClick={onAdd}><Plus size={19} />添加药品</button></div>
    <div className="cabinet-toolbar"><label className="search-input"><MagnifyingGlass size={20} /><input aria-label="搜索药品" placeholder="搜索药品名称" value={query} onChange={e => setQuery(e.target.value)} /></label><button className={`filter-button ${onlyExpiring ? 'active' : ''}`} aria-pressed={onlyExpiring} onClick={() => setOnlyExpiring(!onlyExpiring)}><WarningCircle size={17} />只看临期 / 已过期</button><span className="muted">共 {visible.length} 种药品</span></div>
    {visible.length ? <div className="cabinet-grid">{visible.map(m => {
      const days = m.expiryDate ? daysUntil(m.expiryDate, today) : null
      return <article key={m.id} className="panel medicine-card"><div className="medicine-card-top"><MedicationIcon medication={m} size={29} /><span className={`expiry-badge ${days !== null && days <= 30 ? 'warning' : ''}`}>{days === null ? '有效期待补充' : days < 0 ? '已过期' : days <= 30 ? `${days} 天后到期` : '有效期内'}</span></div><h2>{m.name}</h2><p className="muted">{m.specification || '未填写规格'}</p><div className="medicine-details"><p><Pill size={16} /><span>每次用量</span><strong>{m.dose}</strong></p><p><Clock size={16} /><span>每日提醒</span><strong>{m.times.join(' / ')}</strong></p><p><CalendarBlank size={16} /><span>有效期至</span><strong>{m.expiryDate || '未填写'}</strong></p></div>{m.notes && <div className="medicine-note">{m.notes}</div>}<div className="medicine-card-footer"><button className="text-button" onClick={() => onEdit(m)}><PencilSimple size={17} />查看 / 编辑</button><button className="icon-button" aria-label={`归档${m.name}`} onClick={() => onArchive(m)}><Archive size={19} /></button></div></article>
    })}<button className="add-medicine-card" onClick={onAdd}><span><Plus size={27} /></span><strong>添加新的药品</strong><small>拍照识别，或手动填写</small></button></div> : <div className="panel empty-state large"><Pill size={46} weight="duotone" /><h3>{query || onlyExpiring ? '没有找到符合条件的药品' : '你的药箱，等待第一份安心'}</h3><p>{query || onlyExpiring ? '试试其他名称，或取消临期筛选。' : '拍照或手动录入，开始管理你的每日服药计划。'}</p><button className="button primary" onClick={onAdd}><Plus size={18} />添加药品</button></div>}
  </>
}

export function History({ records, from, to, onRange, zone, isDemo }: {
  records: MedicationRecord[]; from: string; to: string; onRange: (from: string, to: string) => void; zone: string; isDemo: boolean;
}) {
  const [status, setStatus] = useState('all')
  const visible = records.filter(r => status === 'all' || r.status === status)
  const taken = records.filter(r => r.status === 'taken').length
  function download() {
    const cell = (s: string) => `"${String(s).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`
    const csv = [['服药日期', '计划时间', '药品名称', '每次用量', '状态', '记录时间'], ...visible.map(r => [r.date, r.time, r.medicationName, r.dose, labels[r.status] || r.status, r.recordedAt])].map(row => row.map(cell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${isDemo ? '示例-' : ''}服药记录-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url)
  }
  const labels: Record<string, string> = { taken: '已服用', skipped: '已跳过', snoozed: '已延后' }
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR CARE JOURNAL</div><h1>服药记录<span className="heading-dot">。</span></h1><p>回看每一次认真对待自己的时刻。</p></div><button className="button secondary" disabled={!visible.length} onClick={download}><DownloadSimple size={18} />导出记录</button></div>
    <div className="history-summary"><CheckCircle size={30} weight="duotone" /><div><strong>这段时间，已记录 {taken} 次服用</strong><p>{from} 至 {to} · 每个服药时点显示最后一次确认的状态</p></div><LeafDecoration /></div>
    <section className="panel history-panel"><div className="history-toolbar"><div className="date-range"><label>开始日期<input aria-label="记录开始日期" type="date" value={from} max={to} onChange={e => e.target.value && onRange(e.target.value, to)} /></label><span>—</span><label>结束日期<input aria-label="记录结束日期" type="date" value={to} min={from} onChange={e => e.target.value && onRange(from, e.target.value)} /></label></div><select aria-label="筛选记录状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="taken">已服用</option><option value="snoozed">已延后</option><option value="skipped">已跳过</option></select></div>
      {visible.length ? <div className="table-wrap"><table><thead><tr><th>日期 / 计划时间</th><th>药品</th><th>每次用量</th><th>状态</th><th>记录时间</th></tr></thead><tbody>{visible.map(r => <tr key={r.id}><td><strong>{shortDate(r.date)}</strong><small>{r.time}</small></td><td><strong>{r.medicationName}</strong></td><td>{r.dose}</td><td><span className={`status-label ${r.status}`}>{r.status === 'taken' && <CheckCircle size={14} weight="fill" />}{labels[r.status]}</span></td><td>{timeLabel(r.recordedAt, zone)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><CalendarBlank size={42} weight="duotone" /><h3>这段时间还没有记录</h3><p>在服药计划中确认状态后，记录会出现在这里。</p></div>}
      <div className="panel-footnote"><LockKey size={15} /> 记录仅供个人回顾，不用于诊断或自动调整用药。</div>
    </section>
  </>
}
function LeafDecoration() { return <span className="history-flower" aria-hidden="true"><Sparkle size={45} weight="duotone" /></span> }

export function Settings({ user, config, pushStatus, pushBusy, onEnablePush, onDisablePush, onTestPush, onLogin, onLogout }: {
  user: User | null; config: Config; pushStatus: string; pushBusy: boolean; onEnablePush: () => void; onDisablePush: () => void; onTestPush: () => void; onLogin: () => void; onLogout: () => void;
}) {
  return <>
    <div className="page-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h1>提醒设置<span className="heading-dot">。</span></h1><p>让提醒出现在你需要的时刻。</p></div>{user && <button className="button secondary" onClick={onLogout}>退出账户</button>}</div>
    <div className="settings-grid"><section className="panel settings-panel"><div className="settings-title"><span className="icon-tile"><BellRinging size={24} weight="duotone" /></span><div><h2>通知与提醒</h2><p>在当前设备上接收提醒</p></div><span className={`expiry-badge ${pushStatus !== 'enabled' ? 'warning' : ''}`}>{pushStatus === 'enabled' ? '已开启' : pushStatus === 'denied' ? '已被浏览器阻止' : '未开启'}</span></div>
      <div className="setting-row"><div><h3>系统推送通知</h3><p>服药时间到了，或药品即将过期时通知你。</p></div><button className={`toggle ${pushStatus === 'enabled' ? 'on' : ''}`} role="switch" aria-label="系统推送通知" aria-checked={pushStatus === 'enabled'} disabled={pushBusy} onClick={pushStatus === 'enabled' ? onDisablePush : onEnablePush}><span /></button></div>
      <div className="setting-row"><div><h3>延后提醒</h3><p>点击“延后”，15 分钟后再次提醒。</p></div><span className="setting-value">15 分钟</span></div>
      <div className="setting-row"><div><h3>药品过期提醒</h3><p>有效期前 30 天起，每天提醒一次。</p></div><span className="setting-value">提前 30 天</span></div>
      <div className="notification-test"><button className="button secondary" disabled={pushBusy || pushStatus !== 'enabled'} onClick={onTestPush}><Bell size={18} />发送测试通知</button><span>用一条通知，确认设备已准备好。</span></div>
      <div className="info-note"><Smartphone size={21} /><div><strong>手机上，让提醒随身同行</strong><p>请使用 HTTPS 访问。iPhone / iPad 请先在 Safari 中将本网站“添加到主屏幕”，再从主屏幕打开并开启通知。网络、系统省电设置可能影响送达。</p>{pushStatus === 'denied' && <p>通知已被阻止，请在浏览器的网站权限设置中允许通知后重试。</p>}{!config.pushEnabled && <p>服务端推送当前不可用，请检查服务配置。</p>}</div></div>
    </section><div className="settings-aside"><section className="panel settings-panel"><h2>我的账户</h2>{user ? <><div className="account-avatar large">{(user.name || user.email).slice(0, 1).toUpperCase()}</div><h3>{user.name}</h3><p className="account-detail"><EnvelopeSimple size={17} />{user.email}</p><p className="account-detail"><Globe size={17} />{user.timeZone}</p><p className="field-help">提醒以账户注册时的时区为准。</p></> : <><p className="muted">登录后，你的计划与记录可以跨设备查看。</p><button className="button primary full" onClick={onLogin}>登录 / 注册<ArrowRight size={17} /></button></>}</section><section className="panel settings-panel"><div className="section-heading"><h3><Sparkle size={18} /> AI 药品识别</h3><span className={`tiny-dot ${config.aiEnabled ? '' : 'inactive'}`} /></div><p className="muted">{config.aiEnabled ? '已连接识别服务，添加药品时可以使用拍照识别。' : '尚未连接 AI 服务，目前可以手动录入所有药品信息。'}</p><div className="privacy-note"><ShieldCheck size={17} /> AI 仅提取包装文字，识别结果需由你核对确认。</div></section></div></div>
  </>
}
