import type {
    Api,
    AssistantMessage,
    Context,
    ImageContent,
    Message,
    TextContent,
    ToolCall,
    ToolResultMessage,
    Usage,
    UserMessage,
} from '@earendil-works/pi-ai';

/** Pi Context 无法表达的系统消息，交由请求载荷 hook 在原位置恢复。 */
export type PiLateSystemMessage = {
    sourceIndex: number;
    /** 插在转换后第几条普通消息之前；等于 messages.length 表示位于末尾。 */
    beforeMessageIndex: number;
    text: string;
};

/** 上下文转换的内容保留及空消息诊断，不包含完整提示词。 */
export type PiContextAdapterDiagnostics = {
    /** 保留待处理的 system 数量；最终角色由协议适配层自动决定。 */
    preservedLateSystemCount: number;
    droppedEmptyMessageIndexes: number[];
};

/** 标准 Pi 上下文与必须一并传给载荷适配层的原生 system 消息。 */
export type PiContextAdapterResult = {
    context: Context;
    lateSystemMessages: readonly PiLateSystemMessage[];
    diagnostics: PiContextAdapterDiagnostics;
};

/** 提示词转换或原生 system 恢复失败的稳定分类。 */
export type PiContextAdapterErrorCode =
    | 'invalid-image'
    | 'invalid-tool-call'
    | 'system-payload-mismatch'
    | 'missing-tool-call'
    | 'unsupported-content';

export class PiContextAdapterError extends Error {
    /** 保留消息下标和错误类别，便于将上下文转换失败定位到原始提示词。 */
    constructor(
        message: string,
        readonly code: PiContextAdapterErrorCode,
        readonly sourceIndex: number
    ) {
        super(message);
        this.name = 'PiContextAdapterError';
    }
}

/** 酒馆捕获消息，加上历史工具结果可能携带的错误标记。 */
type SendingMessage = SillyTavern.SendingMessage & {
    name?: string;
    is_error?: boolean;
    isError?: boolean;
};

/** 酒馆多模态内容数组中的单个块。 */
type ContentBlock = NonNullable<Exclude<SendingMessage['content'], string>>[number];
/** 当前转换层允许交给 Pi 的文本或图片输入。 */
type PiInputContent = TextContent | ImageContent;

const IMPORTED_ASSISTANT_API = 'sillytavern-import' as Api;
const IMPORTED_ASSISTANT_PROVIDER = 'sillytavern';
const IMPORTED_ASSISTANT_MODEL = 'prepared-prompt';

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const MEBIBYTE = 1024 * 1024;
const MAX_DATA_URL_HEADER_CHARACTERS = 64;
const MAX_DECODED_IMAGE_HEADER_CHARACTERS = 768;
const MAX_ENCODED_IMAGE_HEADER_CHARACTERS = Math.ceil(MAX_DECODED_IMAGE_HEADER_CHARACTERS / 3) * 4;

export const PI_IMAGE_INPUT_LIMITS = Object.freeze({
    // Five MiB matches the strictest supported provider's common per-image cap.
    // The aggregate/count ceilings bound base64 copies on mobile browsers.
    maxDecodedBytesPerImage: 5 * MEBIBYTE,
    maxDecodedBytesPerContext: 16 * MEBIBYTE,
    maxImagesPerContext: 20,
});

const MAX_ENCODED_CHARACTERS_PER_IMAGE =
    Math.ceil(PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage / 3) * 4;

/** 图片校验时提取的预算元数据，避免 token 预检重复解码图片。 */
export type PiImageMetadata = Readonly<{
    decodedBytes: number;
    dimensions?: Readonly<{
        width: number;
        height: number;
    }>;
}>;

/** 单次上下文转换累计使用的图片数量与解码字节数。 */
type ImageInputBudget = {
    decodedBytes: number;
    imageCount: number;
};

const imageMetadata = new WeakMap<ImageContent, PiImageMetadata>();

/** 读取转换时记录的图片大小和尺寸，供预算检查复用，避免再次解码。 */
export function getPiImageMetadata(image: ImageContent): PiImageMetadata | undefined {
    return imageMetadata.get(image);
}

/** 为导入的历史助手消息补齐零用量结构，避免把历史内容记为本次生成消耗。 */
function makeZeroUsage(): Usage {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
}

/** 转义消息名称中的 XML 特殊字符，防止名称破坏注入标记结构。 */
function escapeXmlText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 将有效的酒馆消息名称转换为可拼接的文本前缀。 */
export function formatSendingMessageName(name: string | undefined): string {
    if (typeof name !== 'string' || name.trim() === '') {
        return '';
    }
    return `<message_name>${escapeXmlText(name)}</message_name>`;
}

/** 识别仅含空白的内容，供严格校验和空消息处理使用。 */
function isBlank(value: string): boolean {
    return value.trim().length === 0;
}

/** 仅接受普通对象或空原型对象，避免把类实例作为结构化消息内容。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** 检查指定偏移处的文件头字节，用于验证声明的图片类型。 */
function hasBytesAt(bytes: string, offset: number, expected: readonly number[]): boolean {
    return expected.every((value, index) => bytes.charCodeAt(offset + index) === value);
}

/** 核对 PNG、JPEG、GIF 或 WebP 文件签名，拒绝伪装为图片的数据。 */
function hasRecognizableImageSignature(mimeType: string, bytes: string): boolean {
    if (mimeType === 'image/png') {
        return hasBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (mimeType === 'image/jpeg') {
        return hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
    }
    if (mimeType === 'image/gif') {
        return bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a');
    }
    if (mimeType === 'image/webp') {
        return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    }
    return false;
}

/** 判断字符是否属于标准 Base64 字母表，供图片载荷逐字符校验使用。 */
function isBase64Character(code: number): boolean {
    return (
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x2b ||
        code === 0x2f
    );
}

/** 按大端读取图片头中的 16 位整数。 */
function readUint16BigEndian(bytes: string, offset: number): number {
    return bytes.charCodeAt(offset) * 0x100 + bytes.charCodeAt(offset + 1);
}

/** 按小端读取图片头中的 16 位整数。 */
function readUint16LittleEndian(bytes: string, offset: number): number {
    return bytes.charCodeAt(offset) + bytes.charCodeAt(offset + 1) * 0x100;
}

/** 按小端读取 WebP 图片头中的 24 位整数。 */
function readUint24LittleEndian(bytes: string, offset: number): number {
    return (
        bytes.charCodeAt(offset) +
        bytes.charCodeAt(offset + 1) * 0x100 +
        bytes.charCodeAt(offset + 2) * 0x10000
    );
}

/** 按大端读取图片头中的 32 位整数，并保持无符号取值。 */
function readUint32BigEndian(bytes: string, offset: number): number {
    return (
        bytes.charCodeAt(offset) * 0x1000000 +
        bytes.charCodeAt(offset + 1) * 0x10000 +
        bytes.charCodeAt(offset + 2) * 0x100 +
        bytes.charCodeAt(offset + 3)
    );
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** 扫描已解码的 JPEG 头部标记以提取尺寸；信息不足时不推测尺寸。 */
function readJpegDimensions(bytes: string): PiImageMetadata['dimensions'] {
    if (bytes.length < 4 || bytes.charCodeAt(0) !== 0xff || bytes.charCodeAt(1) !== 0xd8) {
        return undefined;
    }

    let offset = 2;
    while (offset + 3 < bytes.length) {
        if (bytes.charCodeAt(offset) !== 0xff) {
            offset += 1;
            continue;
        }
        while (offset < bytes.length && bytes.charCodeAt(offset) === 0xff) {
            offset += 1;
        }
        const marker = bytes.charCodeAt(offset);
        offset += 1;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }
        if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) {
            break;
        }
        const segmentLength = readUint16BigEndian(bytes, offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length) {
            break;
        }
        if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
            return {
                height: readUint16BigEndian(bytes, offset + 3),
                width: readUint16BigEndian(bytes, offset + 5),
            };
        }
        offset += segmentLength;
    }
    return undefined;
}

/** 按 WebP 头部编码类型提取尺寸，兼容其不同帧头布局。 */
function readWebpDimensions(bytes: string): PiImageMetadata['dimensions'] {
    if (bytes.length < 30 || !bytes.startsWith('RIFF') || bytes.slice(8, 12) !== 'WEBP') {
        return undefined;
    }

    const chunkType = bytes.slice(12, 16);
    if (chunkType === 'VP8X') {
        return {
            width: readUint24LittleEndian(bytes, 24) + 1,
            height: readUint24LittleEndian(bytes, 27) + 1,
        };
    }
    if (chunkType === 'VP8 ' && bytes.slice(23, 26) === '\x9d\x01\x2a') {
        return {
            width: readUint16LittleEndian(bytes, 26) & 0x3fff,
            height: readUint16LittleEndian(bytes, 28) & 0x3fff,
        };
    }
    if (chunkType === 'VP8L' && bytes.charCodeAt(20) === 0x2f) {
        const b1 = bytes.charCodeAt(21);
        const b2 = bytes.charCodeAt(22);
        const b3 = bytes.charCodeAt(23);
        const b4 = bytes.charCodeAt(24);
        return {
            width: 1 + b1 + ((b2 & 0x3f) << 8),
            height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        };
    }
    return undefined;
}

/** 根据已验证的图片类型分派尺寸读取，无法读取时返回 undefined。 */
function readImageDimensions(bytes: string, mimeType: string): PiImageMetadata['dimensions'] {
    if (mimeType === 'image/png' && bytes.length >= 24) {
        return {
            width: readUint32BigEndian(bytes, 16),
            height: readUint32BigEndian(bytes, 20),
        };
    }
    if (mimeType === 'image/gif' && bytes.length >= 10) {
        return {
            width: readUint16LittleEndian(bytes, 6),
            height: readUint16LittleEndian(bytes, 8),
        };
    }
    if (mimeType === 'image/jpeg') {
        return readJpegDimensions(bytes);
    }
    if (mimeType === 'image/webp') {
        return readWebpDimensions(bytes);
    }
    return undefined;
}

/** 在受限的头部长度内查找 data URL 分隔符，避免对异常长头部做无界扫描。 */
function findDataUrlSeparator(url: string): number {
    const maximumOffset = Math.min(url.length, MAX_DATA_URL_HEADER_CHARACTERS + 1);
    for (let offset = 5; offset < maximumOffset; offset++) {
        if (url.charCodeAt(offset) === 0x2c) {
            return offset;
        }
    }
    return -1;
}

/** 只解码识别图片类型和尺寸所需的有限头部，控制大图转换的内存开销。 */
function decodeImageHeader(url: string, dataStart: number, encodedLength: number): string {
    const prefixLength = Math.min(encodedLength, MAX_ENCODED_IMAGE_HEADER_CHARACTERS);
    return atob(url.slice(dataStart, dataStart + prefixLength));
}

/**
 * 校验 data URL、Base64 编码、文件签名和图片预算，并记录元数据。
 * 仅接收受支持的内嵌图片，失败时携带原始消息下标，不自动下载远程地址。
 */
function parseBase64Image(
    url: string,
    sourceIndex: number,
    imageBudget: ImageInputBudget
): ImageContent {
    if (url.slice(0, 5).toLowerCase() !== 'data:') {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含远程图片 URL；更多来源当前只接受 data URL 图片`,
            'unsupported-content',
            sourceIndex
        );
    }

    if (url.length > MAX_DATA_URL_HEADER_CHARACTERS + 1 + MAX_ENCODED_CHARACTERS_PER_IMAGE) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息的图片超过单张 ${PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage / MEBIBYTE} MiB 上限`,
            'invalid-image',
            sourceIndex
        );
    }

    const separator = findDataUrlSeparator(url);
    if (separator === -1) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含无效的 base64 图片 data URL`,
            'invalid-image',
            sourceIndex
        );
    }

    const headerMatch = /^data:([^;,]+);base64$/i.exec(url.slice(0, separator));
    if (!headerMatch) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含无效的 base64 图片 data URL`,
            'invalid-image',
            sourceIndex
        );
    }

    const [, rawMimeType] = headerMatch;
    const mimeType = rawMimeType.toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息的图片 MIME 类型不受支持；只接受 PNG、JPEG、GIF 或 WebP`,
            'invalid-image',
            sourceIndex
        );
    }

    const dataStart = separator + 1;
    const encodedLength = url.length - dataStart;
    if (encodedLength > MAX_ENCODED_CHARACTERS_PER_IMAGE) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息的图片超过单张 ${PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage / MEBIBYTE} MiB 上限`,
            'invalid-image',
            sourceIndex
        );
    }
    if (encodedLength === 0 || encodedLength % 4 !== 0) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含无效的 base64 图片数据`,
            'invalid-image',
            sourceIndex
        );
    }

    let padding = 0;
    if (url.charCodeAt(url.length - 1) === 0x3d) {
        padding += 1;
        if (url.charCodeAt(url.length - 2) === 0x3d) {
            padding += 1;
        }
    }
    const decodedBytes = (encodedLength / 4) * 3 - padding;
    if (decodedBytes > PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息的图片超过单张 ${PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage / MEBIBYTE} MiB 上限`,
            'invalid-image',
            sourceIndex
        );
    }
    if (imageBudget.imageCount + 1 > PI_IMAGE_INPUT_LIMITS.maxImagesPerContext) {
        throw new PiContextAdapterError(
            `更多来源单次请求最多接受 ${PI_IMAGE_INPUT_LIMITS.maxImagesPerContext} 张图片`,
            'invalid-image',
            sourceIndex
        );
    }
    if (imageBudget.decodedBytes + decodedBytes > PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerContext) {
        throw new PiContextAdapterError(
            `更多来源单次请求的图片总量超过 ${PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerContext / MEBIBYTE} MiB 上限`,
            'invalid-image',
            sourceIndex
        );
    }

    const contentEnd = url.length - padding;
    for (let offset = dataStart; offset < contentEnd; offset++) {
        if (!isBase64Character(url.charCodeAt(offset))) {
            throw new PiContextAdapterError(
                `第 ${sourceIndex} 条消息包含无效的 base64 图片数据`,
                'invalid-image',
                sourceIndex
            );
        }
    }
    for (let offset = contentEnd; offset < url.length; offset++) {
        if (url.charCodeAt(offset) !== 0x3d) {
            throw new PiContextAdapterError(
                `第 ${sourceIndex} 条消息包含无效的 base64 图片数据`,
                'invalid-image',
                sourceIndex
            );
        }
    }

    let decodedHeader: string;
    try {
        decodedHeader = decodeImageHeader(url, dataStart, encodedLength);
    } catch {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含无法解码的 base64 图片数据`,
            'invalid-image',
            sourceIndex
        );
    }

    if (!hasRecognizableImageSignature(mimeType, decodedHeader)) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息的图片数据与声明的 MIME 类型不匹配或缺少有效文件头`,
            'invalid-image',
            sourceIndex
        );
    }

    imageBudget.imageCount += 1;
    imageBudget.decodedBytes += decodedBytes;

    const image: ImageContent = {
        type: 'image',
        data: url.slice(dataStart),
        mimeType,
    };
    const dimensions = readImageDimensions(decodedHeader, mimeType);
    imageMetadata.set(image, {
        decodedBytes,
        ...(dimensions === undefined ? {} : { dimensions }),
    });
    return image;
}

/** 将酒馆文本或图片块转换为 Pi 内容块，并执行对应的结构与图片校验。 */
function convertContentBlock(
    block: ContentBlock,
    sourceIndex: number,
    allowImages: boolean,
    imageBudget: ImageInputBudget
): PiInputContent {
    if (block.type === 'text') {
        return { type: 'text', text: block.text };
    }
    if (block.type === 'video_url') {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息包含更多来源不支持的视频内容`,
            'unsupported-content',
            sourceIndex
        );
    }
    if (block.type === 'image_url') {
        if (!allowImages) {
            throw new PiContextAdapterError(
                `第 ${sourceIndex} 条 assistant 消息包含无法导入更多来源历史的图片`,
                'unsupported-content',
                sourceIndex
            );
        }
        return parseBase64Image(block.image_url.url, sourceIndex, imageBudget);
    }

    throw new PiContextAdapterError(
        `第 ${sourceIndex} 条消息包含未知内容块`,
        'unsupported-content',
        sourceIndex
    );
}

/** 统一处理字符串和多块消息内容，逐块转换为 Pi 输入格式。 */
function convertContent(
    content: SendingMessage['content'],
    sourceIndex: number,
    allowImages: boolean,
    imageBudget: ImageInputBudget
): PiInputContent[] {
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    return content.map(block => convertContentBlock(block, sourceIndex, allowImages, imageBudget));
}

/** 判断内容块是否包含可发送的文本或图片。 */
function contentHasValue(content: PiInputContent[]): boolean {
    return content.some(block => block.type === 'image' || !isBlank(block.text));
}

/** 拼接文本内容块，供只允许纯文本的消息角色使用。 */
function compactTextBlocks(content: PiInputContent[]): PiInputContent[] {
    return content.filter(block => block.type === 'image' || !isBlank(block.text));
}

/** 提取 system 消息的纯文本，统一拒绝不支持的系统内容。 */
function extractSystemText(message: SendingMessage, sourceIndex: number): string {
    const content = message.content;
    let text: string;
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        const textBlocks = content.map(block => {
            if (block.type !== 'text') {
                throw new PiContextAdapterError(
                    `第 ${sourceIndex} 条 system 消息包含非文本内容`,
                    'unsupported-content',
                    sourceIndex
                );
            }
            return block.text;
        });
        text = textBlocks.join('');
    } else {
        text = '';
    }

    const name = formatSendingMessageName(message.name);
    return [name, text].filter(value => value !== '').join('\n');
}

/** 在消息正文前保留酒馆角色名，并避免生成空的名称前缀。 */
function addNamePrefix(content: PiInputContent[], name: string | undefined): PiInputContent[] {
    const prefix = formatSendingMessageName(name);
    if (!prefix) {
        return content;
    }
    return [{ type: 'text', text: prefix }, ...content];
}

/** 将历史工具参数解析为普通对象，拒绝无效 JSON 或非对象参数。 */
function parseToolArguments(argumentsValue: string, sourceIndex: number): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(argumentsValue);
    } catch {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条 assistant 消息包含无法解析的工具参数`,
            'invalid-tool-call',
            sourceIndex
        );
    }
    if (!isPlainObject(parsed)) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条 assistant 消息的工具参数必须是 JSON object`,
            'invalid-tool-call',
            sourceIndex
        );
    }
    return parsed;
}

/** 校验历史工具调用标识和参数，并转换为 Pi 工具调用块。 */
function convertToolCalls(
    message: SendingMessage,
    sourceIndex: number,
    toolNamesById: Map<string, string>
): ToolCall[] {
    return (message.tool_calls ?? []).map(call => {
        if (!call.id || !call.function?.name) {
            throw new PiContextAdapterError(
                `第 ${sourceIndex} 条 assistant 消息包含无效工具调用`,
                'invalid-tool-call',
                sourceIndex
            );
        }
        const existingName = toolNamesById.get(call.id);
        if (existingName && existingName !== call.function.name) {
            throw new PiContextAdapterError(
                `工具调用 ID ${call.id} 对应了多个工具名`,
                'invalid-tool-call',
                sourceIndex
            );
        }
        toolNamesById.set(call.id, call.function.name);
        return {
            type: 'toolCall',
            id: call.id,
            name: call.function.name,
            arguments: parseToolArguments(call.function.arguments, sourceIndex),
        };
    });
}

/** 转换历史助手文本和工具调用，并补齐 Pi 要求的历史消息元数据。 */
function convertAssistantMessage(
    message: SendingMessage,
    sourceIndex: number,
    now: () => number,
    toolNamesById: Map<string, string>,
    imageBudget: ImageInputBudget
): AssistantMessage {
    const textContent = compactTextBlocks(
        addNamePrefix(
            convertContent(message.content, sourceIndex, false, imageBudget),
            message.name
        )
    ) as TextContent[];
    const toolCalls = convertToolCalls(message, sourceIndex, toolNamesById);
    return {
        role: 'assistant',
        content: [...textContent, ...toolCalls],
        api: IMPORTED_ASSISTANT_API,
        provider: IMPORTED_ASSISTANT_PROVIDER,
        model: IMPORTED_ASSISTANT_MODEL,
        usage: makeZeroUsage(),
        stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp: now(),
    };
}

/** 将工具返回值关联到已知调用，保留工具名、错误标记及多模态结果。 */
function convertToolResultMessage(
    message: SendingMessage,
    sourceIndex: number,
    now: () => number,
    toolNamesById: Map<string, string>,
    imageBudget: ImageInputBudget
): ToolResultMessage {
    const toolCallId = message.tool_call_id;
    if (!toolCallId) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条 tool 消息缺少 tool_call_id`,
            'missing-tool-call',
            sourceIndex
        );
    }
    const toolName = toolNamesById.get(toolCallId);
    if (!toolName) {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条 tool 消息找不到对应的历史工具调用`,
            'missing-tool-call',
            sourceIndex
        );
    }
    return {
        role: 'toolResult',
        toolCallId,
        toolName,
        content: compactTextBlocks(convertContent(message.content, sourceIndex, true, imageBudget)),
        isError: message.is_error === true || message.isError === true,
        timestamp: now(),
    };
}

/** 所有来源统一丢弃空消息，并保留原始下标用于诊断。 */
function recordEmptyMessage(sourceIndex: number, diagnostics: PiContextAdapterDiagnostics): void {
    diagnostics.droppedEmptyMessageIndexes.push(sourceIndex);
}

/**
 * 把酒馆最终提示词转换为 Pi 上下文，并返回转换诊断。
 * 前置 system 合并为系统提示词；后置 system 单独保留内容及原位置，由载荷 hook 恢复。
 * 同时校验工具关联和图片预算、清理空消息；渠道兼容由载荷适配层处理。
 * now 只供测试注入稳定时间，不提供渠道相关的转换策略开关。
 */
export function toPiContext(
    input: readonly SendingMessage[],
    now: () => number = Date.now
): PiContextAdapterResult {
    const messages = Array.from(input);
    const diagnostics: PiContextAdapterDiagnostics = {
        preservedLateSystemCount: 0,
        droppedEmptyMessageIndexes: [],
    };

    let leadingSystemEnd = 0;
    while (leadingSystemEnd < messages.length && messages[leadingSystemEnd].role === 'system') {
        leadingSystemEnd++;
    }

    const systemPromptParts: string[] = [];
    for (let index = 0; index < leadingSystemEnd; index++) {
        const text = extractSystemText(messages[index], index);
        if (isBlank(text)) {
            recordEmptyMessage(index, diagnostics);
            continue;
        }
        systemPromptParts.push(text);
    }

    const lateSystemMessages: PiLateSystemMessage[] = [];
    const piMessages: Message[] = [];
    const toolNamesById = new Map<string, string>();
    const imageBudget: ImageInputBudget = { decodedBytes: 0, imageCount: 0 };
    for (let index = leadingSystemEnd; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === 'system') {
            const text = extractSystemText(message, index);
            if (isBlank(text)) {
                recordEmptyMessage(index, diagnostics);
                continue;
            }
            lateSystemMessages.push({
                sourceIndex: index,
                beforeMessageIndex: piMessages.length,
                text,
            });
            continue;
        }
        if (message.role === 'user') {
            const content = addNamePrefix(
                convertContent(message.content, index, true, imageBudget),
                message.name
            );
            if (!contentHasValue(content)) {
                recordEmptyMessage(index, diagnostics);
                continue;
            }
            const compactContent = compactTextBlocks(content);
            const userMessage: UserMessage = {
                role: 'user',
                content:
                    compactContent.length === 1 && compactContent[0].type === 'text'
                        ? compactContent[0].text
                        : compactContent,
                timestamp: now(),
            };
            piMessages.push(userMessage);
            continue;
        }
        if (message.role === 'assistant') {
            const assistantMessage = convertAssistantMessage(
                message,
                index,
                now,
                toolNamesById,
                imageBudget
            );
            if (assistantMessage.content.length === 0) {
                recordEmptyMessage(index, diagnostics);
                continue;
            }
            piMessages.push(assistantMessage);
            continue;
        }
        if (message.role === 'tool') {
            piMessages.push(
                convertToolResultMessage(message, index, now, toolNamesById, imageBudget)
            );
            continue;
        }
        throw new PiContextAdapterError(
            `第 ${index} 条消息包含未知角色`,
            'unsupported-content',
            index
        );
    }
    diagnostics.droppedEmptyMessageIndexes.sort((left, right) => left - right);
    diagnostics.preservedLateSystemCount = lateSystemMessages.length;

    return {
        context: {
            ...(systemPromptParts.length > 0
                ? { systemPrompt: systemPromptParts.join('\n\n') }
                : {}),
            messages: piMessages,
        },
        lateSystemMessages,
        diagnostics,
    };
}
