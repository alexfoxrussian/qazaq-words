import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
    Answer,
    AppMeta,
    Profile,
    ProfileSettings,
    Progress,
    Topic,
    TrainingSession,
    Word,
} from '../../entities/models';

export class QazaqDatabase extends Dexie {
    profiles!: EntityTable<Profile, 'id'>;
    words!: EntityTable<Word, 'id'>;
    topics!: EntityTable<Topic, 'id'>;
    progress!: Table<Progress, [string, string]>;
    sessions!: EntityTable<TrainingSession, 'id'>;
    answers!: EntityTable<Answer, 'id'>;
    settings!: EntityTable<ProfileSettings, 'profileId'>;
    appMeta!: EntityTable<AppMeta, 'key'>;

    constructor(name = 'qazaq-words') {
        super(name);
        this.version(1).stores({
            profiles: 'id, createdAt',
            words: 'id, createdAt, *topicIds',
            topics: 'id, name',
            progress: '[profileId+wordId], profileId, wordId, [profileId+dueAt]',
            sessions: 'id, profileId, [profileId+startedAt], [profileId+status]',
            answers: 'id, profileId, sessionId, [profileId+answeredAt], &[sessionId+questionIndex]',
            settings: 'profileId',
            appMeta: 'key',
        });
        this.version(2)
            .stores({ settings: 'profileId' })
            .upgrade((transaction) =>
                transaction.table('settings').toCollection().modify({ fontSize: 'standard' }),
            );
        this.version(3).stores({ profiles: 'id, createdAt' });
        this.version(4)
            .stores({ settings: 'profileId' })
            .upgrade((transaction) =>
                transaction
                    .table('settings')
                    .toCollection()
                    .modify((settings) => {
                        if (settings.visualStyle === 'modern-new') {
                            settings.visualStyle = 'modern';
                        }
                    }),
            );
    }
}

export const database = new QazaqDatabase();
