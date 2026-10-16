import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  register: vi.fn(), update: vi.fn(), reload: vi.fn(), active: false,
}))
vi.mock('virtual:pwa-register', () => ({ registerSW: mocks.register }))
vi.mock('../training/store', () => ({ useTrainingStore: {
  getState: () => ({ session: mocks.active ? { status: 'active' } : null }),
} }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.active = false
  mocks.register.mockReturnValue(mocks.update)
  vi.stubEnv('PROD', true)
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: {} })
  vi.stubGlobal('window', {
    isSecureContext: true, matchMedia: () => ({ matches: false }), addEventListener: vi.fn(),
    location: { reload: mocks.reload }, setInterval: vi.fn(),
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('PWA lifecycle', () => {
  it('checks automatically on registration and hourly while visible without activating an update', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    await import('./runtime')
    const update = vi.fn().mockResolvedValue(undefined)
    mocks.register.mock.calls[0][0].onRegisteredSW('/sw.js', { active: {}, update })
    await Promise.resolve()
    expect(update).toHaveBeenCalledOnce()
    const tick = vi.mocked(window.setInterval).mock.calls[0][0] as () => void
    tick()
    expect(update).toHaveBeenCalledOnce()
    now.mockReturnValue(3601000)
    tick()
    expect(update).toHaveBeenCalledTimes(2)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
    now.mockRestore()
  })
  it('explains HTTP access from a phone without starting offline preparation', async () => {
    vi.stubGlobal('window', { isSecureContext: false, matchMedia: () => ({ matches: false }), addEventListener: vi.fn() })
    vi.stubGlobal('navigator', { onLine: true })
    const { pwaRuntime } = await import('./runtime')
    expect(mocks.register).not.toHaveBeenCalled()
    expect(pwaRuntime.snapshot().supported).toBe(false)
    expect(pwaRuntime.snapshot().error).toContain('HTTPS')
  })
  it('handles a secure browser without service worker support', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const { pwaRuntime } = await import('./runtime')
    expect(mocks.register).not.toHaveBeenCalled()
    expect(pwaRuntime.snapshot().error).toContain('не поддерживает')
  })
  it('reloads once an approved update takes control', async () => {
    const { pwaRuntime } = await import('./runtime')
    const callbacks = mocks.register.mock.calls[0][0]
    callbacks.onNeedRefresh()
    expect(pwaRuntime.snapshot().update).toBe(true)
    expect(mocks.reload).not.toHaveBeenCalled()
    await pwaRuntime.update()
    expect(mocks.update).toHaveBeenCalledOnce()
    callbacks.onNeedReload()
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it('protects a guest or profile session when another tab activates an update', async () => {
    const { pwaRuntime } = await import('./runtime')
    mocks.active = true
    mocks.register.mock.calls[0][0].onNeedReload()
    await pwaRuntime.update()
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    mocks.active = false
    await pwaRuntime.update()
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it('does not reload an idle tab without its own approval', async () => {
    const { pwaRuntime } = await import('./runtime')
    mocks.register.mock.calls[0][0].onNeedReload()
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(pwaRuntime.snapshot().update).toBe(true)
  })
  it('keeps the offline version usable when an update check fails', async () => {
    const { pwaRuntime } = await import('./runtime')
    const update = vi.fn().mockRejectedValue(new Error('network'))
    mocks.register.mock.calls[0][0].onRegisteredSW('/sw.js', { active: {}, update })
    await pwaRuntime.checkUpdate()
    expect(pwaRuntime.snapshot().ready).toBe(true)
    expect(pwaRuntime.snapshot().error).toContain('Сохранённая версия')
  })
})
