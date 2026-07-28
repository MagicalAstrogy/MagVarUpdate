import {
    CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
    CharacterSettingsOverride,
    CharacterSettingsOverridePath,
    CharacterSettingsOverrideValue,
    isCharacterSettingsOverrideEntryName,
    normalizeCharacterSettingsOverride,
    parseCharacterSettingsOverrideContent,
    recoverCharacterSettingsOverridePassthrough,
    serializeCharacterSettingsOverride,
} from '@/function/character_override/schema';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { klona } from 'klona';

type RawWorldbookEntry = SillyTavern.FlattenedWorldInfoEntry & Record<string, unknown>;
type RawWorldbookData = {
    entries: Record<string, RawWorldbookEntry>;
    originalData?: Record<string, unknown>;
    [key: string]: unknown;
};

type SaveResult =
    | {
          status: 'saved';
          data: RawWorldbookData;
          entry_uid: number;
          content: string;
      }
    | {
          status: 'discarded';
          data: RawWorldbookData;
      };

const REGEX_SAVE_DEBOUNCE_MS = 350;
const MAX_WORLD_INFO_UID = 1_000_000;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getCharacterName(): string {
    try {
        return String(SillyTavern.getCharacterCardFields()?.name ?? '');
    } catch {
        return '';
    }
}

function getSortedRawEntries(data: RawWorldbookData): RawWorldbookEntry[] {
    return _(data.entries).values().sortBy('displayIndex').value();
}

function getMatchingRawEntries(data: RawWorldbookData): RawWorldbookEntry[] {
    return getSortedRawEntries(data).filter(
        entry => entry.disable === true && isCharacterSettingsOverrideEntryName(entry.comment)
    );
}

async function loadRawWorldbook(worldbook_name: string): Promise<RawWorldbookData> {
    const loaded = (await SillyTavern.loadWorldInfo(worldbook_name)) as unknown;
    if (!_.isPlainObject(loaded) || !_.isPlainObject(_.get(loaded, 'entries'))) {
        throw new Error(
            tr('runtime.characterOverride.worldbookReadFailed', { worldbook: worldbook_name })
        );
    }
    return klona(loaded) as RawWorldbookData;
}

function getFreeUid(data: RawWorldbookData): number {
    const used_uids = new Set(getSortedRawEntries(data).map(entry => Number(entry.uid)));
    for (let uid = 0; uid < MAX_WORLD_INFO_UID; uid++) {
        if (!used_uids.has(uid)) {
            return uid;
        }
    }
    throw new Error(tr('runtime.characterOverride.noAvailableUid'));
}

function makeCharacterBookEntry(uid: number, display_index: number, content: string) {
    return {
        id: uid,
        keys: [],
        secondary_keys: [],
        comment: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
        content,
        constant: false,
        selective: false,
        insertion_order: 100,
        enabled: false,
        position: 'after_char',
        extensions: {
            display_index,
        },
    };
}

function createRawConfigEntry(
    uid: number,
    display_index: number,
    content: string
): RawWorldbookEntry {
    const original = makeCharacterBookEntry(uid, display_index, content);
    const converted = SillyTavern.convertCharacterBook({
        name: '',
        entries: [original],
    });
    const raw = converted.entries[String(uid)] ?? converted.entries[uid];
    if (!raw) {
        throw new Error(tr('runtime.characterOverride.entryCreationFailed'));
    }
    return raw as RawWorldbookEntry;
}

function syncOriginalEntry(
    data: RawWorldbookData,
    uid: number,
    display_index: number,
    content: string
) {
    const original_entries = _.get(data, 'originalData.entries');
    if (!Array.isArray(original_entries) && !_.isPlainObject(original_entries)) {
        return;
    }

    const entries = Array.isArray(original_entries)
        ? original_entries
        : Object.values(original_entries as Record<string, unknown>);
    const existing = entries.find(entry => {
        const identifier = _.get(entry, 'id') ?? _.get(entry, 'uid');
        return identifier !== undefined && Number(identifier) === uid;
    });
    if (_.isPlainObject(existing)) {
        Object.assign(existing, {
            comment: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
            content,
            enabled: false,
        });
        if (_.has(existing, 'disable')) {
            _.set(existing, 'disable', true);
        }
        return;
    }

    const new_original = makeCharacterBookEntry(uid, display_index, content);
    if (Array.isArray(original_entries)) {
        original_entries.push(new_original);
    } else {
        (original_entries as Record<string, unknown>)[String(uid)] = new_original;
    }
}

function findRawEntryRecord(
    data: RawWorldbookData,
    uid: number
): [string, RawWorldbookEntry] | undefined {
    return Object.entries(data.entries).find(([, entry]) => Number(entry.uid) === uid);
}

async function confirmConflict(worldbook_name: string): Promise<boolean> {
    const result = await SillyTavern.callGenericPopup(
        tr('runtime.characterOverride.conflictPrompt', {
            worldbook: _.escape(worldbook_name),
            entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
        }),
        SillyTavern.POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: tr('runtime.characterOverride.overwriteButton'),
            cancelButton: tr('runtime.characterOverride.loadLatestButton'),
        }
    );
    return result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
}

class CharacterSettingsOverrideController {
    private worldbook_name: string | null = null;
    private entry_uid: number | null = null;
    private expected_content: string | null = null;
    private draft: CharacterSettingsOverride = {};
    private is_valid = true;
    private revision = 0;
    private has_pending_save = false;
    private is_saving = false;
    private save_timer: ReturnType<typeof setTimeout> | undefined;
    private save_loop: Promise<void> | undefined;
    private stop_event: (() => void) | undefined;
    private stopped = false;
    private duplicate_warning_signature = '';
    private saving_revision: number | undefined;
    private worldbook_update_revision = 0;

    private isCurrent(): boolean {
        return active_controller === this;
    }

    private mirrorState(values: Partial<ReturnType<typeof useDataStore>['character_settings']>) {
        if (this.isCurrent()) {
            Object.assign(useDataStore().character_settings, values);
        }
    }

    async init(): Promise<void> {
        const store = useDataStore();
        store.resetCharacterSettings();
        store.character_settings.character_name = getCharacterName();

        try {
            this.worldbook_name = getCharWorldbookNames('current').primary;
        } catch (error) {
            this.worldbook_name = null;
            console.error(tr('runtime.characterOverride.bindingReadFailedLog'), error);
        }

        if (!this.worldbook_name) {
            this.mirrorState({
                status: 'unbound',
                worldbook_name: null,
                is_valid: true,
                draft: {},
            });
            return;
        }

        this.mirrorState({
            status: 'loading',
            worldbook_name: this.worldbook_name,
        });

        const worldinfo_listener = (name: string, data: unknown) =>
            this.handleWorldinfoUpdated(name, data);
        eventOn(tavern_events.WORLDINFO_UPDATED, worldinfo_listener);
        this.stop_event = () =>
            eventRemoveListener(tavern_events.WORLDINFO_UPDATED, worldinfo_listener);

        try {
            await this.reload();
        } catch (error) {
            const message = getErrorMessage(error);
            console.error(tr('runtime.characterOverride.readFailedLog'), error);
            toastr.error(
                tr('runtime.common.errorCause', { cause: _.escape(message) }),
                tr('runtime.characterOverride.readFailedTitle'),
                { timeOut: 5000 }
            );
            this.mirrorState({
                status: 'error',
                worldbook_name: this.worldbook_name,
                is_valid: false,
                draft: {},
            });
        }

        if (this.stopped || !this.isCurrent()) {
            return;
        }
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.stop_event?.();
        this.stop_event = undefined;
        if (this.save_timer !== undefined) {
            clearTimeout(this.save_timer);
            this.save_timer = undefined;
        }

        // 等待当前保存以及它因更新版本而衍生出的后续保存；失败时再额外尝试一次，
        // 尽量避免切换聊天恰好发生在临时保存错误后而丢失草稿。
        for (let attempt = 0; attempt < 2; attempt++) {
            this.startSaveLoop();
            await this.waitForSaveLoops();
            if (!this.has_pending_save) {
                return;
            }
        }

        console.error(
            tr('runtime.characterOverride.stopWithUnsavedChangesLog', {
                worldbook: this.worldbook_name ?? '',
            })
        );
    }

    private async reload() {
        if (!this.worldbook_name) {
            return;
        }
        const update_revision = this.worldbook_update_revision;
        const data = await loadRawWorldbook(this.worldbook_name);
        if (update_revision !== this.worldbook_update_revision || this.stopped) {
            return;
        }
        await this.applyWorldbookData(data);
    }

    private async handleWorldinfoUpdated(name: string, data: unknown) {
        if (
            name !== this.worldbook_name ||
            this.stopped ||
            this.has_pending_save ||
            this.is_saving
        ) {
            return;
        }

        const update_revision = ++this.worldbook_update_revision;
        try {
            const worldbook_data =
                _.isPlainObject(data) && _.isPlainObject(_.get(data, 'entries'))
                    ? (klona(data) as RawWorldbookData)
                    : await loadRawWorldbook(name);
            if (
                update_revision !== this.worldbook_update_revision ||
                this.stopped ||
                this.has_pending_save ||
                this.is_saving
            ) {
                return;
            }
            await this.applyWorldbookData(worldbook_data);
        } catch (error) {
            if (
                update_revision !== this.worldbook_update_revision ||
                this.stopped ||
                this.has_pending_save ||
                this.is_saving
            ) {
                return;
            }
            this.is_valid = false;
            this.draft = {};
            this.revision++;
            this.mirrorState({
                status: 'error',
                draft: {},
                is_valid: false,
                revision: this.revision,
            });
            console.error(tr('runtime.characterOverride.reloadFailedLog'), error);
            toastr.error(
                tr('runtime.common.errorCause', {
                    cause: _.escape(getErrorMessage(error)),
                }),
                tr('runtime.characterOverride.reloadFailedTitle'),
                {
                    timeOut: 5000,
                }
            );
        }
    }

    private getMatchingEntries(data: RawWorldbookData): RawWorldbookEntry[] {
        const matches = getMatchingRawEntries(data);
        const signature = matches.length > 1 ? matches.map(entry => entry.uid).join(',') : '';
        if (signature !== '' && signature !== this.duplicate_warning_signature) {
            toastr.warning(
                tr('runtime.characterOverride.duplicateEntries', {
                    worldbook: _.escape(this.worldbook_name ?? ''),
                    count: matches.length,
                    entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                }),
                tr('runtime.characterOverride.duplicateEntriesTitle'),
                { timeOut: 5000 }
            );
        }
        this.duplicate_warning_signature = signature;
        return matches;
    }

    private async applyWorldbookData(data: RawWorldbookData) {
        if (!_.isPlainObject(data.entries)) {
            throw new Error(
                tr('runtime.characterOverride.invalidWorldbookData', {
                    worldbook: this.worldbook_name ?? '',
                })
            );
        }

        const matches = this.getMatchingEntries(data);
        const entry = matches[0];

        this.entry_uid = entry ? Number(entry.uid) : null;
        this.expected_content = entry?.content ?? null;
        this.revision++;
        this.is_valid = true;
        this.draft = {};

        if (entry) {
            try {
                this.draft = parseCharacterSettingsOverrideContent(entry.content);
            } catch (error) {
                this.is_valid = false;
                try {
                    this.draft = recoverCharacterSettingsOverridePassthrough(entry.content);
                } catch {
                    this.draft = {};
                }
                console.error(
                    tr('runtime.characterOverride.invalidConfigurationLog', {
                        worldbook: this.worldbook_name ?? '',
                        entry: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                    }),
                    error
                );
                toastr.error(
                    tr('runtime.characterOverride.invalidConfiguration', {
                        worldbook: _.escape(this.worldbook_name ?? ''),
                        cause: _.escape(getErrorMessage(error)),
                    }),
                    tr('runtime.characterOverride.invalidConfigurationTitle'),
                    { timeOut: 7000 }
                );
            }
        }

        this.mirrorState({
            status: 'ready',
            worldbook_name: this.worldbook_name,
            entry_uid: this.entry_uid,
            expected_content: this.expected_content,
            draft: klona(this.draft),
            is_valid: this.is_valid,
            revision: this.revision,
            has_pending_save: this.has_pending_save,
            is_saving: this.is_saving,
        });
    }

    patch(path: CharacterSettingsOverridePath, value: CharacterSettingsOverrideValue) {
        if (this.stopped || !this.worldbook_name || !this.isCurrent()) {
            return;
        }

        const next = klona(this.draft);
        const [root, child] = path.split('.') as [keyof CharacterSettingsOverride, string?];
        const should_delete =
            value === undefined ||
            (typeof value === 'string' &&
                (path.endsWith('白名单正则') || path.endsWith('黑名单正则')) &&
                value.trim() === '');

        if (!child) {
            if (should_delete) {
                delete next[root];
            } else {
                _.set(next, root, value);
            }
        } else {
            let parent = next[root];
            if (!_.isPlainObject(parent)) {
                parent = {};
                _.set(next, root, parent);
            }
            if (should_delete) {
                delete (parent as Record<string, unknown>)[child];
            } else {
                (parent as Record<string, unknown>)[child] = value;
            }
            if (Object.keys(parent as object).length === 0) {
                delete next[root];
            }
        }

        this.draft = normalizeCharacterSettingsOverride(next);
        this.is_valid = true;
        this.revision++;
        this.has_pending_save = true;
        this.mirrorState({
            draft: klona(this.draft),
            is_valid: true,
            revision: this.revision,
            has_pending_save: true,
        });

        if (path.endsWith('白名单正则') || path.endsWith('黑名单正则')) {
            if (this.save_timer !== undefined) {
                clearTimeout(this.save_timer);
            }
            this.save_timer = setTimeout(() => {
                this.save_timer = undefined;
                this.startSaveLoop();
            }, REGEX_SAVE_DEBOUNCE_MS);
        } else {
            if (this.save_timer !== undefined) {
                clearTimeout(this.save_timer);
                this.save_timer = undefined;
            }
            this.startSaveLoop();
        }
    }

    async flush(): Promise<void> {
        if (this.save_timer !== undefined) {
            clearTimeout(this.save_timer);
            this.save_timer = undefined;
        }
        this.startSaveLoop();
        await this.waitForSaveLoops();
    }

    private async waitForSaveLoops(): Promise<void> {
        while (this.save_loop) {
            await this.save_loop;
        }
    }

    private startSaveLoop() {
        if (this.save_loop || !this.has_pending_save || !this.worldbook_name) {
            return;
        }
        let failed_revision: number | undefined;
        this.save_loop = this.runSaveLoop()
            .catch(error => {
                failed_revision = this.saving_revision;
                this.has_pending_save = true;
                this.mirrorState({ has_pending_save: true });
                console.error(tr('runtime.characterOverride.saveFailedLog'), error);
                toastr.error(
                    tr('runtime.common.errorCause', {
                        cause: _.escape(getErrorMessage(error)),
                    }),
                    tr('runtime.characterOverride.saveFailedTitle'),
                    {
                        timeOut: 7000,
                    }
                );
            })
            .finally(() => {
                this.is_saving = false;
                this.save_loop = undefined;
                this.mirrorState({ is_saving: false });
                if (
                    this.has_pending_save &&
                    this.save_timer === undefined &&
                    (failed_revision === undefined || this.revision > failed_revision)
                ) {
                    this.startSaveLoop();
                }
            });
    }

    private async runSaveLoop() {
        while (this.has_pending_save && this.worldbook_name && this.save_timer === undefined) {
            this.has_pending_save = false;
            const revision = this.revision;
            this.saving_revision = revision;
            const draft = klona(this.draft);
            this.is_saving = true;
            this.mirrorState({
                has_pending_save: false,
                is_saving: true,
            });

            const result = await this.saveSnapshot(draft);
            this.is_saving = false;

            if (result.status === 'discarded') {
                this.has_pending_save = false;
                await this.applyWorldbookData(result.data);
                return;
            }

            this.entry_uid = result.entry_uid;
            this.expected_content = result.content;
            this.mirrorState({
                entry_uid: result.entry_uid,
                expected_content: result.content,
                is_saving: false,
            });

            if (this.revision === revision && !this.has_pending_save) {
                await this.applyWorldbookData(result.data);
            }
        }
    }

    private async saveSnapshot(draft: CharacterSettingsOverride): Promise<SaveResult> {
        const worldbook_name = this.worldbook_name!;
        const content = serializeCharacterSettingsOverride(draft);
        let data = await loadRawWorldbook(worldbook_name);
        let matches = this.getMatchingEntries(data);

        let expected_record =
            this.entry_uid === null ? undefined : findRawEntryRecord(data, this.entry_uid);
        const has_conflict =
            this.entry_uid === null
                ? matches.length > 0
                : expected_record === undefined ||
                  expected_record[1].content !== this.expected_content;

        if (has_conflict) {
            if (!(await confirmConflict(worldbook_name))) {
                return {
                    status: 'discarded',
                    data: await loadRawWorldbook(worldbook_name),
                };
            }

            // 弹框期间世界书中的其他条目仍可能变化；确认只授权覆盖配置条目，
            // 因此必须基于最新整本数据重新定位目标，避免回滚无关修改。
            data = await loadRawWorldbook(worldbook_name);
            matches = this.getMatchingEntries(data);
            expected_record =
                this.entry_uid === null ? undefined : findRawEntryRecord(data, this.entry_uid);
        }

        let target_record = expected_record;
        if (!target_record && matches[0]) {
            target_record = findRawEntryRecord(data, Number(matches[0].uid));
        }

        let entry_uid: number;
        if (target_record) {
            entry_uid = Number(target_record[1].uid);
            const display_index = Number(target_record[1].displayIndex ?? 0);
            Object.assign(target_record[1], {
                comment: CHARACTER_SETTINGS_OVERRIDE_ENTRY_NAME,
                content,
                disable: true,
            });
            syncOriginalEntry(data, entry_uid, display_index, content);
        } else {
            entry_uid = getFreeUid(data);
            const display_index =
                (_.max(getSortedRawEntries(data).map(entry => Number(entry.displayIndex ?? -1))) ??
                    -1) + 1;
            const created = createRawConfigEntry(entry_uid, display_index, content);
            data.entries[String(entry_uid)] = created;
            syncOriginalEntry(data, entry_uid, display_index, content);
        }

        // 立即保存，确保返回前 WORLDINFO_UPDATED 已触发，便于区分自身更新和外部更新。
        // SillyTavern 的立即保存会提交 loadWorldInfo 缓存中的最新整本数据；这里只定点修改配置条目。
        await SillyTavern.saveWorldInfo(worldbook_name, data, true);
        try {
            SillyTavern.reloadWorldInfoEditor(worldbook_name);
        } catch (error) {
            console.warn(tr('runtime.characterOverride.editorRefreshFailedLog'), error);
        }
        return {
            status: 'saved',
            data,
            entry_uid,
            content,
        };
    }
}

let active_controller: CharacterSettingsOverrideController | undefined;

export async function initCharacterSettingsOverride(): Promise<() => Promise<void>> {
    const controller = new CharacterSettingsOverrideController();
    active_controller = controller;
    await controller.init();
    return async () => {
        if (active_controller === controller) {
            active_controller = undefined;
        }
        await controller.stop();
    };
}

export function setCharacterSettingsOverride(
    path: CharacterSettingsOverridePath,
    value: CharacterSettingsOverrideValue
) {
    active_controller?.patch(path, value);
}

export async function flushCharacterSettingsOverrideSave(): Promise<void> {
    await active_controller?.flush();
}
