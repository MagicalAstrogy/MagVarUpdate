/**
 * 测试场景：为 mvu_zod 兼容测试下载并加载远程模块，在 jsdom 中提供其依赖和 Schema 注册环境。
 * 该辅助模块使用真实网络读取远程产物，并通过缓存、重试及用例级清理保持测试可重复。
 */
import https from 'https';
import { beforeAll, beforeEach } from '@jest/globals';
import { klona } from 'klona';
import YAML from 'yaml';
import type { ZodType } from 'zod';
import * as zod from 'zod';
import { toDotPath } from 'zod/v4/core';

export type RegisterMvuSchema = (input: ZodType) => void;

const mvuZodUrl =
    'https://raw.githubusercontent.com/StageDog/tavern_resource/main/dist/util/mvu_zod.js';
const mvuZodSourceCacheKey = '__magVarUpdateLatestMvuZodSource';

/** 远程依赖准备：带超时和重定向上限读取模块文本。 */
function fetchText(url: string, redirectCount = 0): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            {
                headers: {
                    'User-Agent': 'MagVarUpdate compatibility tests',
                },
            },
            response => {
                if (
                    response.statusCode &&
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {
                    response.resume();
                    if (redirectCount >= 5) {
                        reject(new Error(`Too many redirects while fetching ${mvuZodUrl}`));
                        return;
                    }
                    resolve(
                        fetchText(
                            new URL(response.headers.location, url).toString(),
                            redirectCount + 1
                        )
                    );
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(
                        new Error(
                            `Failed to fetch ${mvuZodUrl}: HTTP ${response.statusCode ?? 'unknown'}`
                        )
                    );
                    return;
                }

                response.setEncoding('utf8');
                let content = '';
                response.on('data', chunk => {
                    content += chunk;
                });
                response.on('end', () => resolve(content));
            }
        );

        request.setTimeout(15_000, () => {
            request.destroy(new Error(`Timed out while fetching ${mvuZodUrl}`));
        });
        request.on('error', reject);
    });
}

/** 网络重试：下载暂时失败时退避重试，达到上限后保留失败。 */
async function fetchTextWithRetry(url: string, maxAttempts = 5): Promise<string> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fetchText(url);
        } catch (error) {
            if (attempt >= maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 2 ** (attempt - 1) * 500));
        }
    }
}

/** 共享缓存：同一 Jest worker 复用模块下载，失败时清除缓存以允许下次重试。 */
async function fetchLatestMvuZodSource(): Promise<string> {
    // 同一个 Jest worker 中的多个测试文件共用一次下载，避免并发请求放大 GitHub Raw 的网络抖动。
    const sharedProcess = process as typeof process & {
        [mvuZodSourceCacheKey]?: Promise<string>;
    };
    sharedProcess[mvuZodSourceCacheKey] ??= fetchTextWithRetry(mvuZodUrl);

    try {
        return await sharedProcess[mvuZodSourceCacheKey];
    } catch (error) {
        delete sharedProcess[mvuZodSourceCacheKey];
        throw error;
    }
}

/** 模块装载：替换远程模块的环境依赖，执行后取得 Schema 注册接口。 */
export async function loadLatestMvuZod(): Promise<RegisterMvuSchema> {
    const source = await fetchLatestMvuZodSource();
    let runnableSource = source.replace(/\bimport\s*['"][^'"]+['"]\s*;?/g, '');

    const replaceImport = (importedName: string, globalName: string) => {
        const importPattern = new RegExp(
            `\\bimport\\s*\\{\\s*${importedName}(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?\\s*\\}\\s*from\\s*['"][^'"]+['"]\\s*;?`
        );
        let replaced = false;
        runnableSource = runnableSource.replace(
            importPattern,
            (_match, alias: string | undefined) => {
                replaced = true;
                return `const ${alias ?? importedName}=globalThis.${globalName};`;
            }
        );
        if (!replaced) {
            throw new Error(`Unable to replace the ${importedName} import in ${mvuZodUrl}`);
        }
    };

    replaceImport('toDotPath', '__mvuZodToDotPath');
    replaceImport('klona', '__mvuZodKlona');

    const exportPattern =
        /\bexport\s*\{\s*(?:([A-Za-z_$][\w$]*)\s+as\s+)?registerMvuSchema\s*\}\s*;?/;
    let exportReplaced = false;
    runnableSource = runnableSource.replace(
        exportPattern,
        (_match, localName: string | undefined) => {
            exportReplaced = true;
            return `globalThis.__mvuZodRegisterMvuSchema=${localName ?? 'registerMvuSchema'};`;
        }
    );
    if (!exportReplaced) {
        throw new Error(`Unable to find the registerMvuSchema export in ${mvuZodUrl}`);
    }

    (globalThis as any).__mvuZodToDotPath = toDotPath;
    (globalThis as any).__mvuZodKlona = klona;
    (globalThis as any).z = zod;
    (globalThis as any).YAML = YAML;
    (globalThis as any).toastr = {
        error: () => undefined,
        warning: () => undefined,
        ...(globalThis as any).toastr,
    };
    (globalThis as any).registerVariableSchema ??= () => undefined;

    Function(runnableSource)();

    const registerMvuSchema = (globalThis as any).__mvuZodRegisterMvuSchema;
    if (typeof registerMvuSchema !== 'function') {
        throw new Error(`Invalid registerMvuSchema export loaded from ${mvuZodUrl}`);
    }
    return registerMvuSchema;
}

/** 用例环境：注册远程模块的加载钩子，并在每个用例前重置其所需状态。 */
export function setupLatestMvuZod(): void {
    let registerMvuSchema: RegisterMvuSchema;

    beforeAll(async () => {
        registerMvuSchema = await loadLatestMvuZod();
    }, 90_000);

    beforeEach(() => {
        registerMvuSchema(zod.z.any());
    });
}
