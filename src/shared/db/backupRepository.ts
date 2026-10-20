import {
    backupTables,
    validateBackup,
    type Backup,
    type BackupData,
} from '../../features/import-export/backup';
import { database, type QazaqDatabase } from './database';
import { ConfirmationRequired } from './dictionaryRepository';
export function createBackupRepository(db: QazaqDatabase) {
    const tables = backupTables.map((name) => db.table(name));
    return {
        async export(): Promise<Backup> {
            return db.transaction('r', tables, async () => {
                const data = Object.fromEntries(
                    await Promise.all(
                        backupTables.map(async (name) => [name, await db.table(name).toArray()]),
                    ),
                ) as unknown as BackupData;
                return validateBackup({
                    format: 'qazaq-words-backup',
                    schemaVersion: 1,
                    exportedAt: new Date().toISOString(),
                    data,
                });
            });
        },
        async restore(value: unknown, confirmed = false) {
            const backup = validateBackup(value);
            await db.transaction('rw', tables, async () => {
                if (!confirmed) {
                    throw new ConfirmationRequired([
                        'Все текущие данные будут заменены резервной копией. Состояние активных тренировок будет заменено состоянием из копии.',
                    ]);
                }
                for (const table of tables) {
                    await table.clear();
                }
                for (const name of backupTables) {
                    await db.table(name).bulkAdd(backup.data[name]);
                }
            });
        },
    };
}
export const backupRepository = createBackupRepository(database);
