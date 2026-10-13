interface IconProps {
  name: 'book' | 'arrow' | 'check' | 'info' | 'file'
  className?: string
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'book' && <><path d="M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3Z" /><path d="M12 6v15" /></>}
      {name === 'arrow' && <><path d="M4 12h16" /><path d="m14 6 6 6-6 6" /></>}
      {name === 'check' && <path d="m5 12 4 4L19 6" />}
      {name === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>}
      {name === 'file' && <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 12h8M8 16h5" /></>}
    </svg>
  )
}
