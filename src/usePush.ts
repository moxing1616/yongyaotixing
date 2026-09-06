import { useCallback, useEffect, useState } from 'react'
import { api, post, messageOf } from './api'
import type { Config, User } from './types'

function applicationKey(value: string) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
export function usePush(user: User | null, config: Config, notify: (text: string, error?: boolean) => void, login: () => void) {
  const [status, setStatus] = useState('disabled')
  const [busy, setBusy] = useState(false)
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
  useEffect(() => {
    let active = true
    setStatus(supported && Notification.permission === 'denied' ? 'denied' : 'disabled')
    if (supported && user) navigator.serviceWorker.ready.then(async reg => {
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const result = await api<{ subscribed: boolean }>(`/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`)
        if (active && result.subscribed) setStatus('enabled')
      }
    }).catch(() => {})
    return () => { active = false }
  }, [supported, user])
  const enable = useCallback(async () => {
    if (!user) { login(); return }
    if (!supported) { notify('当前浏览器不支持推送。请使用 HTTPS；iPhone 请从主屏幕打开应用。', true); return }
    if (!config.pushEnabled || !config.vapidPublicKey) { notify('推送服务尚未就绪，请稍后重试。', true); return }
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setStatus(permission === 'denied' ? 'denied' : 'disabled'); throw new Error('通知未获授权。你仍可在今日列表查看到点提醒。') }
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(config.vapidPublicKey) })
      await post('/push/subscribe', sub.toJSON())
      setStatus('enabled'); notify('已开启当前设备的服药与过期提醒。')
    } catch (error) { notify(messageOf(error), true) } finally { setBusy(false) }
  }, [user, config, supported, login, notify])
  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) { await post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe() }
      setStatus('disabled'); notify('已关闭当前设备的系统推送。')
    } catch (error) { notify(messageOf(error), true) } finally { setBusy(false) }
  }, [notify])
  const test = useCallback(async () => {
    setBusy(true)
    try { await post('/push/test'); notify('测试通知已提交给推送服务，请检查系统通知。') } catch (error) { notify(messageOf(error), true) } finally { setBusy(false) }
  }, [notify])
  return { status, busy, enable, disable, test }
}
