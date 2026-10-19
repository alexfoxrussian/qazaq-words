import { useEffect, useState, type ReactNode } from 'react';
import { useProfileStore } from '../features/profiles/store';
import { profileRepository } from '../shared/db/profileRepository';
import { dataErrorMessage } from '../shared/db/errors';
import { BentoCard, Button } from '../shared/ui/components';
import { DictionarySyncProvider } from '../features/dictionary-sync/DictionarySyncProvider';

export function DataGate({ children }: { children: ReactNode }) {
    const status = useProfileStore((state) => state.status);
    const error = useProfileStore((state) => state.error);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let disposed = false;
        let subscription: { unsubscribe: () => void } | undefined;
        useProfileStore.getState().loading();
        void profileRepository
            .initialize()
            .then(() => {
                if (disposed) {
                    return;
                }
                subscription = profileRepository.observe().subscribe({
                    next: (snapshot) => {
                        if (!disposed) {
                            useProfileStore.getState().applySnapshot(snapshot);
                        }
                    },
                    error: (cause: unknown) => {
                        if (!disposed) {
                            useProfileStore.getState().fail(dataErrorMessage(cause));
                        }
                    },
                });
            })
            .catch((cause: unknown) => {
                if (!disposed) {
                    useProfileStore.getState().fail(dataErrorMessage(cause));
                }
            });
        return () => {
            disposed = true;
            subscription?.unsubscribe();
        };
    }, [attempt]);
    if (status === 'loading') {
        return (
            <BentoCard>
                <p role="status">Загружаем локальные данные…</p>
            </BentoCard>
        );
    }
    if (status === 'error') {
        return (
            <BentoCard title="Хранилище недоступно">
                <p role="alert">{error}</p>
                <Button onClick={() => setAttempt((value) => value + 1)}>Повторить загрузку</Button>
            </BentoCard>
        );
    }
    return <DictionarySyncProvider>{children}</DictionarySyncProvider>;
}
