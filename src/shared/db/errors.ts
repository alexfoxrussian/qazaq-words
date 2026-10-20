export class ValidationError extends Error {}
export class ActiveSessionError extends Error {
    constructor() {
        super('Сначала завершите активную тренировку перед сменой профиля.');
    }
}

export function dataErrorMessage(error: unknown): string {
    if (error instanceof ValidationError || error instanceof ActiveSessionError) {
        return error.message;
    }
    if (error instanceof Error && error.name === 'QuotaExceededError') {
        return 'Недостаточно места в браузере. Изменения не сохранены. Освободите место и повторите операцию.';
    }
    return 'Не удалось прочитать или сохранить данные в браузере. Изменения не подтверждены. Проверьте доступ к хранилищу и повторите операцию.';
}
