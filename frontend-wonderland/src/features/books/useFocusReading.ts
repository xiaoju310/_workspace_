import { useEffect, useState } from 'react'

/** Transient view state only: never store it in the book or recreate the reader. */
export function useFocusReading(scope: string, available: boolean, onChange?: (active: boolean) => void) {
  const [owner, setOwner] = useState<string | null>(null)
  const active = available && owner === scope
  useEffect(() => { if (!available || owner !== scope) setOwner(null) }, [available, scope, owner])
  useEffect(() => {
    onChange?.(active)
    return () => onChange?.(false)
  }, [active, onChange])
  useEffect(() => {
    if (!active) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOwner(null) }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [active])
  return { active, setActive: (value: boolean) => setOwner(value && available ? scope : null) }
}
