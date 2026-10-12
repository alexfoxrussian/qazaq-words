import { useEffect, useLayoutEffect, useState } from 'react'
import { useProfileStore } from '../features/profiles/store'
export function AppearanceProvider() {
  const settings = useProfileStore((state) => state.settings)
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const change = () => setDark(query.matches)
    query.addEventListener('change', change); change()
    return () => query.removeEventListener('change', change)
  }, [])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings?.colorMode === 'light' ? 'light' : settings?.colorMode === 'dark' ? 'dark' : dark ? 'dark' : 'light'
    root.dataset.palette = settings?.palette ?? 'blue'
    root.dataset.fontSize = settings?.fontSize ?? 'standard'
    root.dataset.style = settings?.visualStyle ?? 'modern'
  }, [settings, dark])
  return null
}
