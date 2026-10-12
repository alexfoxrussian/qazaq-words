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
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }), addEventListener: vi.fn(),
    location: { reload: mocks.reload },
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('PWA lifecycle', () => {
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
