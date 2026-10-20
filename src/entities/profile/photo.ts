import { ValidationError } from '../../shared/db/errors';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_LENGTH = 200_000;
export function validateAvatar(value: unknown): asserts value is string {
    if (
        typeof value !== 'string' ||
        value.length > MAX_AVATAR_LENGTH ||
        !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value) ||
        value.slice(23).length % 4 !== 0
    ) {
        throw new ValidationError('Некорректное фото профиля.');
    }
}
export async function prepareProfilePhoto(file: File): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new ValidationError('Выберите фото в формате JPG, PNG или WebP.');
    }
    if (file.size > MAX_PHOTO_BYTES) {
        throw new ValidationError('Фото должно быть не больше 5 МБ.');
    }
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new ValidationError('Не удалось прочитать изображение. Выберите другой файл.');
    }
    try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 25_000_000) {
            throw new ValidationError(
                'Изображение слишком большое: максимум 25 миллионов пикселей.',
            );
        }
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new ValidationError('Не удалось обработать фото.');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, 256, 256);
        const side = Math.min(bitmap.width, bitmap.height);
        context.drawImage(
            bitmap,
            (bitmap.width - side) / 2,
            (bitmap.height - side) / 2,
            side,
            side,
            0,
            0,
            256,
            256,
        );
        const result = canvas.toDataURL('image/jpeg', 0.85);
        validateAvatar(result);
        return result;
    } finally {
        bitmap.close();
    }
}
