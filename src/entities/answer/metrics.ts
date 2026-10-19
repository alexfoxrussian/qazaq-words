export function calculateAccuracy(correctCount: number, answeredCount: number): number | null {
    return answeredCount ? Math.round((correctCount / answeredCount) * 100) : null;
}
