import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useProfileStore } from '../features/profiles/store';
import { useTrainingStore } from '../features/training/store';
import { guestRepository } from '../features/training/guestRepository';
import { trainingRepository } from '../shared/db/trainingRepository';
import { dataErrorMessage } from '../shared/db/errors';
import { BentoCard, Button } from '../shared/ui/components';

export function TrainingProvider({ children }: { children: ReactNode }) {
    const profileId = useProfileStore((state) => state.activeProfile?.id);
    const training = useTrainingStore();
    const location = useLocation();
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const state = useTrainingStore.getState();
        if (state.session && state.session.status !== 'active') {
            state.setView('prepare');
        }
    }, [location.key]);
    useEffect(() => {
        if (!profileId) {
            guestRepository.reset();
            useTrainingStore.getState().loading('guest');
            useTrainingStore.getState().apply('guest', { session: null, answers: [] });
            return;
        }
        let disposed = false;
        useTrainingStore.getState().loading(profileId);
        const subscription = trainingRepository.observe(profileId).subscribe({
            next: (snapshot) => {
                if (!disposed) {
                    useTrainingStore.getState().apply(profileId, snapshot);
                }
            },
            error: (cause: unknown) => {
                if (!disposed) {
                    useTrainingStore.getState().fail(dataErrorMessage(cause));
                }
            },
        });
        return () => {
            disposed = true;
            subscription.unsubscribe();
        };
    }, [profileId, attempt]);
    if (profileId && (training.profileId !== profileId || training.status === 'loading')) {
        return (
            <BentoCard>
                <p role="status">Загружаем историю тренировки…</p>
            </BentoCard>
        );
    }
    if (profileId && training.status === 'error') {
        return (
            <BentoCard>
                <p role="alert">{training.error}</p>
                <Button onClick={() => setAttempt((value) => value + 1)}>Повторить загрузку</Button>
            </BentoCard>
        );
    }
    return (
        <>
            {location.pathname !== '/training' &&
                profileId &&
                training.session?.status === 'active' && (
                    <p>
                        <Link to="/training">
                            Есть сохранённая тренировка — продолжить или завершить →
                        </Link>
                    </p>
                )}
            {children}
        </>
    );
}
