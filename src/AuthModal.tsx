import { useState, type FormEvent } from 'react'
import { ArrowRight, EnvelopeSimple, LockKey, ShieldCheck, Pill } from '@phosphor-icons/react'
import { Modal } from './Modal'
import { post, messageOf } from './api'
import { localZone } from './dates'
import type { User } from './types'

export function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: User) => void }) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const user = await post<User>(`/auth/${register ? 'register' : 'login'}`, {
        email: data.get('email'), password: data.get('password'), name: data.get('name'), timeZone: localZone(),
      })
      onSuccess(user)
    } catch (error) { setError(messageOf(error)) } finally { setBusy(false) }
  }
  return <Modal title={register ? '从今天起，安心服药' : '欢迎回来'} subtitle={register ? '创建账户，让每一次提醒都有迹可循。' : '登录后，继续照顾好自己。'} onClose={onClose}>
    <div className="auth-logo"><Pill size={34} weight="duotone" /></div>
    <form onSubmit={submit} className="form-stack">
      {register && <label>你的称呼<input name="name" autoComplete="nickname" placeholder="怎么称呼你" required maxLength={40} /></label>}
      <label>邮箱地址<div className="input-with-icon"><EnvelopeSimple size={19} /><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></div></label>
      <label>密码<div className="input-with-icon"><LockKey size={19} /><input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '至少 8 位字符' : '输入你的密码'} required minLength={register ? 8 : 1} maxLength={128} /></div></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button primary full" disabled={busy}>{busy ? '正在连接…' : register ? '创建账户' : '登录'}<ArrowRight size={18} /></button>
    </form>
    <p className="auth-switch">{register ? '已经有账户？' : '还没有账户？'}<button className="text-button" onClick={() => { setRegister(!register); setError('') }}>{register ? '立即登录' : '免费注册'}</button></p>
    <p className="privacy-note"><ShieldCheck size={16} /> 药品与服药记录仅在你的账户中可见</p>
  </Modal>
}
