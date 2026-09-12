import {
    createEntryFilterContext,
    filterEntries,
    type EntryFilterContext,
    type LoreEntries,
} from '@/function/request/filter_entries';
import {
    getPendingWorldinfoRequests,
    type WorldinfoRequest,
} from '@/function/request/worldinfo_request';
import { useDataStore } from '@/store';

type Entry = Record<string, any>;
const LORE_SOURCES = ['globalLore', 'characterLore', 'chatLore', 'personaLore'] as const;
// 使用生僻字序列，降低临时探针书名与用户世界书名称碰撞的概率。
const PROBE_WORLD_PREFIX = '龘靐齉';
// CJK 扩展 A 的前 128 个字（U+3400–U+347F），均为单个 UTF-16 码元。
const PROBE_ID_ALPHABET = Array.from({ length: 128 }, (_, index) =>
    String.fromCharCode(0x3400 + index)
).join('');
const SNAPSHOT_KEY = '__mvu_worldinfo_snapshot';
const REQUEST_KEY = '__mvu_worldinfo_request';

/** 随禁用的元数据探针一起被宿主克隆，保留本次扫描的完整来源及规则。 */
type ScanSnapshot = {
    lores: LoreEntries;
    main_context: EntryFilterContext;
    requests: readonly WorldinfoRequest[];
};

/** WORLDINFO_SCAN_DONE 中本模块实际使用的可变字段，均属于同一次扫描。 */
export type WorldinfoScanData = {
    state: { current: number; next: number; loopCount: number };
    new: { all: Entry[]; successful: Entry[] };
    activated: { entries: Map<string, Entry>; text: string };
    sortedEntries: Entry[];
};

/** 首轮确定的删除集合及已保留的公开递归文本，供后续轮次复用。 */
type ScanFilter = { removed: Set<string>; recursion_text: string };
// 宿主在同一次扫描的各轮复用 sortedEntries；弱引用让扫描结束后的状态自然释放。
const scan_filters = new WeakMap<Entry[], ScanFilter>();

/**
 * 生成跨宿主克隆仍稳定的条目标识，避免依赖对象引用。
 *
 * @param entry 含世界书名称和书内唯一 uid 的条目。
 * @returns 序列化后的二元组，避免名称中的分隔符造成键冲突。
 */
function entryKey(entry: Entry): string {
    return JSON.stringify([entry.world, entry.uid]);
}

/** 每个生僻字编码 7 bit，以固定 5 位保留完整的 4B 无符号随机数。 */
function createProbeWorld(): string {
    let random = crypto.getRandomValues(new Uint32Array(1))[0];
    let suffix = '';
    for (let index = 0; index < 5; index++) {
        suffix = PROBE_ID_ALPHABET[random & 0x7f] + suffix;
        random >>>= 7;
    }
    return `${PROBE_WORLD_PREFIX}${suffix}`;
}

/** 判断条目是否使用本模块保留的临时世界书前缀，供识别和清理探针。 */
function isProbe(entry: Entry): boolean {
    return typeof entry.world === 'string' && entry.world.startsWith(PROBE_WORLD_PREFIX);
}

/**
 * 创建只参与关键词匹配、不进入实际激活集合的临时探针基础数据。
 *
 * 负概率让匹配结果留在 new.all 中，但不占预算、最低激活数或递归文本。
 * 这些数据仅供当前扫描使用，不应保存为普通世界书条目。
 *
 * @param world 本次扫描独有的临时世界书名称。
 * @param uid 临时书内编号；调用方用 -1 放置禁用的快照条目，其余编号放识别条目。
 * @returns 待补充匹配关键词或扫描快照的条目对象。
 */
function makeProbe(world: string, uid: number): Entry {
    return {
        world,
        uid,
        comment: 'MVU request probe',
        content: '',
        key: [],
        keysecondary: [],
        constant: false,
        selective: false,
        disable: false,
        order: -Number.MAX_SAFE_INTEGER,
        position: 0,
        matchCharacterDescription: true,
        scanDepth: 1,
        matchWholeWords: false,
        caseSensitive: true,
        ignoreBudget: true,
        preventRecursion: true,
        excludeRecursion: true,
        delayUntilRecursion: 0,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        group: '',
        triggers: [],
        // 酒馆 new.all 保留匹配的候选条目。负概率确保探针永不真正激活，
        // 即使 Math.random() === 0，也不占用预算、最低激活数或递归文本。
        useProbability: true,
        probability: -1,
    };
}

/**
 * 在世界书加载后保存来源快照，并为在途请求插入识别探针。
 *
 * 有在途请求且额外分析开关开启时，保留业务条目，等待扫描结果揭示请求身份。
 * 其余情况直接执行普通生成的扫描前过滤；空世界书不插入探针，保留宿主短路行为。
 *
 * @param lores 宿主提供的四组临时 lore 数组；本函数会原地插入探针或执行普通过滤。
 */
export async function onWorldinfoEntriesLoaded(lores: LoreEntries) {
    const requests = getPendingWorldinfoRequests();
    const main_context = await createEntryFilterContext(false);
    if (
        !useDataStore().runtimes.is_during_extra_analysis ||
        requests.length === 0 ||
        LORE_SOURCES.every(source => lores[source].length === 0)
    ) {
        await filterEntries(lores, main_context);
        return;
    }

    // 保存未激活/禁用条目的元数据，以保留“整本书存在标记即支持”的规则。
    const original_lores: LoreEntries = {
        globalLore: [],
        characterLore: [],
        chatLore: [],
        personaLore: [],
    };
    for (const source of LORE_SOURCES) {
        original_lores[source] = lores[source].map(entry => ({
            world: entry.world,
            uid: entry.uid,
            comment: entry.comment,
        }));
    }
    const snapshot: ScanSnapshot = {
        lores: original_lores,
        main_context,
        requests,
    };
    const world = createProbeWorld();
    // 元数据只放在临时探针上。给业务条目增加字段会改变 ST 的哈希，破坏 timed effects。
    lores.characterLore.push({
        ...makeProbe(world, -1),
        disable: true,
        [SNAPSHOT_KEY]: snapshot,
    });
    requests.forEach((request, index) => {
        lores.characterLore.push({
            ...makeProbe(world, index),
            key: [request.marker],
            [REQUEST_KEY]: request.marker,
        });
    });
}

/**
 * 从首轮候选探针恢复请求身份，并在每一轮扫描后清理被排除的条目。
 *
 * 识别读取 new.all，因为探针故意不通过概率检查，不会进入 activated.entries。
 * 首轮用完整加载快照计算删除集合，后续轮次复用该集合，不再依赖在途列表或全局阶段。
 * 公共数组、激活映射和文本会同步清理；事件前已发生的预算竞争及私有递归缓冲无法回滚。
 *
 * @param data 宿主当前扫描轮次的可变数据，会被原地更新。
 */
export async function onWorldinfoScanDone(data: WorldinfoScanData) {
    let filter = scan_filters.get(data.sortedEntries);
    if (!filter) {
        const anchor = data.sortedEntries.find(entry => isProbe(entry) && entry[SNAPSHOT_KEY]);
        if (!anchor) return;
        const snapshot = anchor[SNAPSHOT_KEY] as ScanSnapshot;
        const matched_markers = new Set(
            data.new.all.filter(isProbe).map(entry => entry[REQUEST_KEY])
        );
        const matches = snapshot.requests.filter(request => matched_markers.has(request.marker));
        // 无标记的并发请求按正常生成处理。出现多个标记时也不冒认成某个额外请求。
        const context = matches.length === 1 ? matches[0].filter_context : snapshot.main_context;
        // 在完整加载集合上求差，保留未激活标记条目对整本支持情况的影响。
        const all_keys = new Set(
            LORE_SOURCES.flatMap(source => snapshot.lores[source].map(entryKey))
        );
        await filterEntries(snapshot.lores, context);
        for (const source of LORE_SOURCES) {
            for (const entry of snapshot.lores[source]) all_keys.delete(entryKey(entry));
        }
        filter = { removed: all_keys, recursion_text: '' };
        scan_filters.set(data.sortedEntries, filter);
    }

    /** 各公开集合共用同一删除条件，避免条目只从最终提示词或候选集合中的一处被移除。 */
    const should_remove = (entry: Entry) => isProbe(entry) || filter.removed.has(entryKey(entry));
    _.remove(data.sortedEntries, should_remove);
    _.remove(data.new.all, should_remove);
    _.remove(data.new.successful, should_remove);
    for (const [key, entry] of data.activated.entries) {
        if (should_remove(entry)) data.activated.entries.delete(key);
    }
    // 与 ST 的公开 activated.text 保持相同拼接方式。私有递归 buffer 在事件前已更新，
    // 首轮包含组/预算选择及已进入私有 buffer 的文本无法从这个事件完全回滚。
    if (data.state.next) {
        const text = data.new.successful
            .filter(entry => !entry.preventRecursion)
            .map(entry => entry.content)
            .join('\n');
        if (text) filter.recursion_text = `${text}\n${filter.recursion_text}`;
    }
    if (filter.removed.size > 0) data.activated.text = filter.recursion_text;
}
