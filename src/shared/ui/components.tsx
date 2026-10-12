import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import type { Profile } from '../../entities/models'
import styles from './ui.module.css'

export function ProfileAvatar({ profile, className = '' }: { profile: Profile | null; className?: string }) {
  return <span className={`${styles.avatar} ${className}`} aria-hidden="true">{profile?.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : <UserRound size={24} />}</span>
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'destructive' }) {
  return <button className={`${styles.button} ${styles[variant]} ${className}`} {...props} />
}

export function IconButton({ label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Button variant="secondary" className={styles.iconButton} aria-label={label} title={label} {...props} />
}

export function BentoCard({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return <section className={`${styles.card} ${className}`}>{title && <h2>{title}</h2>}{children}</section>
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">◇</span><h3>{title}</h3><p>{children}</p>{action}</div>
}

export function FormField({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return <label className={styles.field} htmlFor={id}><span>{label}</span><input id={id} {...props} /></label>
}

export function Modal({ title, children, onClose, closeLabel = 'Понятно', busy = false, focusCancel = false }: { title: string; children: ReactNode; onClose: () => void; closeLabel?: string; busy?: boolean; focusCancel?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    dialog?.showModal()
    if (focusCancel) dialog?.querySelector<HTMLButtonElement>('[data-modal-close]')?.focus()
    return () => { dialog?.close(); trigger?.focus() }
  }, [focusCancel])
  return <dialog ref={ref} className={styles.modal} aria-labelledby="dialog-title" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="dialog-title">{title}</h2>{children}<Button variant="secondary" data-modal-close disabled={busy} onClick={onClose}>{closeLabel}</Button>
  </dialog>
}
