import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger'
  title: string
  children?: ReactNode
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name="info" />
      <div>
        <strong>{title}</strong>
        {children ? <div className="alert-body">{children}</div> : null}
      </div>
    </div>
  )
}
