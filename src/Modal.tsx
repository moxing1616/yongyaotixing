import { useEffect, useRef, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="modal-title" onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose() }}>
    <header className="modal-header"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={22} /></button></header>
    {children}
  </dialog>
}
