import { registerSW } from 'virtual:pwa-register';
import { useTrainingStore } from '../training/store';

interface InstallPrompt extends Event {
    prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
    supported: boolean;
    ready: boolean;
    update: boolean;
    online: boolean;
    installed: boolean;
    canInstall: boolean;
    error: string | null;
}
const supported = window.isSecureContext && 'serviceWorker' in navigator;
let state: PwaState = {
    supported,
    ready: false,
    update: false,
    online: navigator.onLine,
    installed:
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    canInstall: false,
    error: !window.isSecureContext
        ? 'Для установки и работы офлайн откройте приложение по HTTPS. По локальному HTTP-адресу доступна работа в браузере.'
        : !supported
          ? 'Этот браузер не поддерживает офлайн-режим. Откройте приложение в актуальном Chrome, Edge или Safari.'
          : null,
};
const listeners = new Set<() => void>();
let installPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | undefined;
let reloadPending = false;
let updateApproved = false;
let lastCheck = 0;
function publish(change: Partial<PwaState>) {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
}
export const pwaRuntime = {
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    snapshot: () => state,
    async install() {
        const prompt = installPrompt;
        if (!prompt) {
            return;
        }
        installPrompt = null;
        publish({ canInstall: false, error: null });
        try {
            await prompt.prompt();
        } catch {
            publish({ error: 'Не удалось открыть установку. Попробуйте через меню браузера.' });
        }
    },
    async checkUpdate() {
        if (!registration || !navigator.onLine) {
            return;
        }
        lastCheck = Date.now();
        try {
            await registration.update();
            publish({ error: null });
        } catch {
            publish({
                error: 'Не удалось проверить обновления. Сохранённая версия продолжает работать.',
            });
        }
    },
    async update() {
        if (useTrainingStore.getState().session?.status === 'active') {
            return;
        }
        publish({ error: null });
        updateApproved = true;
        if (reloadPending) {
            window.location.reload();
        } else {
            try {
                await updateServiceWorker();
            } catch {
                updateApproved = false;
                publish({ error: 'Не удалось применить обновление. Попробуйте ещё раз.' });
            }
        }
    },
};
const updateServiceWorker =
    import.meta.env.PROD && supported
        ? registerSW({
              immediate: true,
              onOfflineReady: () => publish({ ready: true }),
              onNeedRefresh: () => publish({ update: true }),
              // Another tab can activate the worker. Never reload this tab implicitly.
              onNeedReload: () => {
                  reloadPending = true;
                  if (updateApproved && useTrainingStore.getState().session?.status !== 'active') {
                      window.location.reload();
                  } else {
                      publish({ update: true });
                  }
              },
              onRegisteredSW: (_url, value) => {
                  registration = value;
                  if (value?.active) {
                      publish({ ready: true });
                  }
                  void pwaRuntime.checkUpdate();
              },
              onRegisterError: () =>
                  publish({
                      error: 'Офлайн-версия пока недоступна. Проверьте соединение и перезагрузите страницу.',
                  }),
          })
        : async () => {};

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    publish({ canInstall: true });
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    publish({ installed: true, canInstall: false });
});
window.addEventListener('online', () => {
    publish({ online: true });
    void pwaRuntime.checkUpdate();
});
window.addEventListener('offline', () => publish({ online: false }));
window.addEventListener('focus', () => {
    if (Date.now() - lastCheck > 60 * 60 * 1000) {
        void pwaRuntime.checkUpdate();
    }
});

// Check long-running visible sessions too; never activate or reload automatically.
if (import.meta.env.PROD && supported) {
    window.setInterval(
        () => {
            if (
                document.visibilityState === 'visible' &&
                Date.now() - lastCheck >= 60 * 60 * 1000
            ) {
                void pwaRuntime.checkUpdate();
            }
        },
        60 * 60 * 1000,
    );
}
