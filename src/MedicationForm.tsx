import { useRef, useState, type FormEvent, type ChangeEvent } from 'react'
import { Camera, UploadSimple, Sparkle, Check, ArrowRight, ArrowLeft, Plus, X, PencilSimple, WarningCircle } from '@phosphor-icons/react'
import { Modal } from './Modal'
import { post, messageOf } from './api'
import type { Medication, MedicationInput, Recognition, Color } from './types'

const MAX_FILE = 8 * 1024 * 1024
export function MedicationForm({ existing, today, aiEnabled, onClose, onSave }: {
  existing?: Medication; today: string; aiEnabled: boolean; onClose: () => void;
  onSave: (data: MedicationInput, id?: string) => Promise<void>;
}) {
  const [step, setStep] = useState(existing ? 2 : 1)
  const [values, setValues] = useState<MedicationInput>(existing ? {
    name: existing.name, specification: existing.specification, expiryDate: existing.expiryDate,
    instructions: existing.instructions, dose: existing.dose, times: [...existing.times],
    startDate: existing.startDate, endDate: existing.endDate, notes: existing.notes, color: existing.color,
  } : {
    name: '', specification: '', expiryDate: '', instructions: '', dose: '', times: ['08:00'],
    startDate: today, endDate: '', notes: '', color: 'sage',
  })
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const update = <K extends keyof MedicationInput>(key: K, value: MedicationInput[K]) => setValues(previous => ({ ...previous, [key]: value }))
  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('请选择 JPG、PNG 或 WebP 图片。iPhone 可使用相机拍照。'); return }
    if (file.size > MAX_FILE) { setError('图片不能超过 8 MB，请压缩或重新拍摄。'); return }
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.onerror = () => setError('图片读取失败，请重新选择。')
    reader.readAsDataURL(file)
  }
  async function recognize() {
    setBusy(true); setError('')
    try {
      const result = await post<Recognition>('/recognize', { image })
      setValues(previous => ({ ...previous, name: result.name, specification: result.specification, expiryDate: result.expiryDate, instructions: result.instructions }))
      setWarnings(result.warnings); setStep(2); setConfirmed(false)
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (step === 2) { setStep(3); setError(''); return }
    if (!confirmed) { setError('请先确认药品信息与服用计划。'); return }
    if (values.endDate && values.endDate < values.startDate) { setError('结束日期不能早于开始日期。'); return }
    if (new Set(values.times).size !== values.times.length) { setError('提醒时间不能重复。'); return }
    setBusy(true); setError('')
    try { await onSave({ ...values, times: [...values.times].sort() }, existing?.id) } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }
  return <Modal wide title={existing ? '编辑药品与提醒' : '添加一份安心'} subtitle="核对药品信息，设置适合你的提醒计划。" onClose={() => { if (!busy) onClose() }}>
    <div className="steps">{['拍照 / 手动添加', '确认药品信息', '设置提醒'].map((label, i) => <div key={label} className={step >= i + 1 ? 'active' : ''}><span>{step > i + 1 ? <Check size={14} /> : `0${i + 1}`}</span>{label}</div>)}</div>
    {step === 1 ? <div className="upload-step">
      <input ref={uploadRef} className="visually-hidden" aria-label="选择药品图片" type="file" accept="image/jpeg,image/png,image/webp" onChange={pickImage} />
      <input ref={cameraRef} className="visually-hidden" aria-label="拍摄药品图片" type="file" accept="image/*" capture="environment" onChange={pickImage} />
      <div className={`upload-area ${image ? 'has-image' : ''}`}>
        {image ? <img src={image} alt="待识别药品照片预览" /> : <><div className="upload-icon"><Camera size={38} weight="duotone" /></div><h3>拍下药盒，信息轻松录入</h3><p>请拍清药品名称、规格和有效期</p></>}
        <div className="upload-buttons"><button className="button primary" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera size={18} />{image ? '重新拍摄' : '拍照'}</button><button className="button secondary" onClick={() => uploadRef.current?.click()} disabled={busy}><UploadSimple size={18} />选择图片</button></div>
        <small>支持 JPG、PNG、WebP · 最大 8 MB</small>
      </div>
      {!aiEnabled && <p className="info-note"><WarningCircle size={18} /> AI 识别尚未配置，你可以先手动录入药品。</p>}
      <p className="privacy-note">点击识别后，照片将发送至所配置的 AI 服务，仅用于提取包装文字。请避免拍入个人信息。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="text-button" onClick={() => { setStep(2); setError('') }} disabled={busy}><PencilSimple size={17} /> 手动填写</button><button className="button primary" disabled={!image || busy || !aiEnabled} onClick={recognize}><Sparkle size={18} />{busy ? '正在识别，请稍候…' : 'AI 识别药品'}</button></div>
    </div> : <form onSubmit={submit} className="form-stack">
      {step === 2 ? <>
        {warnings.length > 0 && <div className="info-note"><WarningCircle size={18} /><span>{warnings.join('；')}</span></div>}
        <label>药品名称 <span className="required">*</span><input value={values.name} onChange={e => update('name', e.target.value)} required maxLength={120} placeholder="请对照药盒填写完整名称" /></label>
        <div className="form-grid"><label>药品规格<input value={values.specification} onChange={e => update('specification', e.target.value)} maxLength={200} placeholder="例如：100 mg × 30片" /></label><label>有效期至<input type="date" value={values.expiryDate} onChange={e => update('expiryDate', e.target.value)} /></label></div>
        <p className="field-help">若有效期只印有年月，请核对包装上的日期规则后填写；留空则无法提供过期提醒。</p>
        <label>包装说明文字<textarea rows={3} value={values.instructions} onChange={e => update('instructions', e.target.value)} maxLength={6000} placeholder="记录包装原文，或补充需要留意的信息" /></label>
        <div><span className="field-label">药品标记色</span><div className="color-options">{(['sage', 'amber', 'blue', 'rose'] as Color[]).map((color, i) => <button key={color} type="button" className={`color-dot ${color} ${values.color === color ? 'selected' : ''}`} aria-label={['草绿', '暖橙', '雾蓝', '藕粉'][i]} aria-pressed={values.color === color} onClick={() => update('color', color)}>{values.color === color && <Check size={16} />}</button>)}</div></div>
      </> : <>
        <div className={`medicine-summary ${values.color}`}><div><strong>{values.name}</strong><p>{values.specification || '未填写规格'}</p></div><span>每日提醒</span></div>
        <label>每次用量 <span className="required">*</span><input value={values.dose} onChange={e => update('dose', e.target.value)} required maxLength={120} placeholder="按照医嘱填写，例如：每次 1 片" /></label>
        <p className="field-help">提醒仅执行你确认的计划；AI 不决定用量、服用频次或补服方式。</p>
        <div><span className="field-label">每天几点提醒 <span className="required">*</span></span><div className="time-inputs">{values.times.map((time, i) => <div key={i}><input aria-label={`提醒时间 ${i + 1}`} type="time" value={time} required onChange={e => update('times', values.times.map((t, index) => i === index ? e.target.value : t))} />{values.times.length > 1 && <button className="icon-button" type="button" aria-label={`删除提醒时间 ${i + 1}`} onClick={() => update('times', values.times.filter((_, index) => index !== i))}><X size={16} /></button>}</div>)}{values.times.length < 8 && <button type="button" className="button dashed" onClick={() => update('times', [...values.times, '20:00'])}><Plus size={17} />添加时间</button>}</div></div>
        <div className="form-grid"><label>开始日期<input type="date" value={values.startDate} onChange={e => update('startDate', e.target.value)} required /></label><label>结束日期（选填）<input type="date" min={values.startDate} value={values.endDate} onChange={e => update('endDate', e.target.value)} /></label></div>
        <label>服用备注<input value={values.notes} onChange={e => update('notes', e.target.value)} maxLength={500} placeholder="例如：医嘱说明、需要注意的事项" /></label>
        <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>我已核对药品名称、有效期及服用计划，确认与医嘱或药品说明一致。</span></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="text-button" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}><ArrowLeft size={17} />上一步</button><button className="button primary" type="submit" disabled={busy}>{busy ? '正在保存…' : step === 2 ? '设置提醒' : '确认并保存'}{step === 2 ? <ArrowRight size={18} /> : <Check size={18} />}</button></div>
    </form>}
  </Modal>
}
