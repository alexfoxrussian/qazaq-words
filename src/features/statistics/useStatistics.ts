import { useEffect, useState } from 'react';
import { statisticsRepository } from '../../shared/db/statisticsRepository';
import { dataErrorMessage } from '../../shared/db/errors';
import type { Period } from '../../entities/answer/statistics';

type Summary = Awaited<ReturnType<typeof statisticsRepository.snapshot>>;
export function useStatistics(profileId: string, period: Period) {
    const [result, setResult] = useState<{
        profileId: string;
        period: Period;
        data?: Summary;
        error?: string;
    } | null>(null);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let disposed = false;
        const subscription = statisticsRepository.observe(profileId, period).subscribe({
            next: (data) => {
                if (!disposed) {
                    setResult({ profileId, period, data });
                }
            },
            error: (cause: unknown) => {
                if (!disposed) {
                    setResult({ profileId, period, error: dataErrorMessage(cause) });
                }
            },
        });
        const timer = window.setInterval(() => setRevision((value) => value + 1), 30_000);
        return () => {
            disposed = true;
            subscription.unsubscribe();
            window.clearInterval(timer);
        };
    }, [profileId, period, revision]);
    return {
        data: result?.profileId === profileId && result.period === period ? result.data : undefined,
        error:
            result?.profileId === profileId && result.period === period ? result.error : undefined,
        retry: () => {
            setResult(null);
            setRevision((value) => value + 1);
        },
    };
}
