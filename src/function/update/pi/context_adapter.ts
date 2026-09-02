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

export type LateSystemPolicy = 'attach-to-nearest-user' | 'strict';
export type ContextAdapterMode = 'strict' | 'lenient';

export type LateSystemMoveDiagnostic = {
    sourceIndex: number;
    targetUserIndex: number;
    placement: 'before' | 'after';
};

export type PiContextAdapterDiagnostics = {
    movedLateSystemCount: number;
    lateSystemMoves: LateSystemMoveDiagnostic[];
    droppedEmptyMessageIndexes: number[];
};

export type ToPiContextOptions = {
    mode?: ContextAdapterMode;
    lateSystemPolicy?: LateSystemPolicy;
    now?: () => number;
};

export type PiContextAdapterResult = {
    context: Context;
    diagnostics: PiContextAdapterDiagnostics;
};

export type PiContextAdapterErrorCode =
    | 'empty-content'
    | 'invalid-image'
    | 'invalid-tool-call'
    | 'late-system'
    | 'missing-tool-call'
    | 'missing-user-for-system'
    | 'unsupported-content';

export class PiContextAdapterError extends Error {
    constructor(
        message: string,
        readonly code: PiContextAdapterErrorCode,
        readonly sourceIndex: number
    ) {
        super(message);
        this.name = 'PiContextAdapterError';
    }
}

type SendingMessage = SillyTavern.SendingMessage & {
    name?: string;
    is_error?: boolean;
    isError?: boolean;
};

type ContentBlock = NonNullable<Exclude<SendingMessage['content'], string>>[number];
type PiInputContent = TextContent | ImageContent;

type LateSystemAttachment = {
    sourceIndex: number;
    text: string;
};

type UserAttachments = {
    before: LateSystemAttachment[];
    after: LateSystemAttachment[];
};

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

export type PiImageMetadata = Readonly<{
    decodedBytes: number;
    dimensions?: Readonly<{
        width: number;
        height: number;
    }>;
}>;

type ImageInputBudget = {
    decodedBytes: number;
    imageCount: number;
};

const imageMetadata = new WeakMap<ImageContent, PiImageMetadata>();

export function getPiImageMetadata(image: ImageContent): PiImageMetadata | undefined {
    return imageMetadata.get(image);
}

export const SYSTEM_INJECTION_OPEN = '<system_injection source="sillytavern">';
export const SYSTEM_INJECTION_CLOSE = '</system_injection>';

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

function escapeXmlText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function formatSendingMessageName(name: string | undefined): string {
    if (typeof name !== 'string' || name.trim() === '') {
        return '';
    }
    return `<message_name>${escapeXmlText(name)}</message_name>`;
}

function formatSystemInjection(text: string): string {
    return `${SYSTEM_INJECTION_OPEN}\n${text}\n${SYSTEM_INJECTION_CLOSE}`;
}

function isBlank(value: string): boolean {
    return value.trim().length === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasBytesAt(bytes: string, offset: number, expected: readonly number[]): boolean {
    return expected.every((value, index) => bytes.charCodeAt(offset + index) === value);
}

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

function isBase64Character(code: number): boolean {
    return (
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x2b ||
        code === 0x2f
    );
}

function readUint16BigEndian(bytes: string, offset: number): number {
    return bytes.charCodeAt(offset) * 0x100 + bytes.charCodeAt(offset + 1);
}

function readUint16LittleEndian(bytes: string, offset: number): number {
    return bytes.charCodeAt(offset) + bytes.charCodeAt(offset + 1) * 0x100;
}

function readUint24LittleEndian(bytes: string, offset: number): number {
    return (
        bytes.charCodeAt(offset) +
        bytes.charCodeAt(offset + 1) * 0x100 +
        bytes.charCodeAt(offset + 2) * 0x10000
    );
}

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

function findDataUrlSeparator(url: string): number {
    const maximumOffset = Math.min(url.length, MAX_DATA_URL_HEADER_CHARACTERS + 1);
    for (let offset = 5; offset < maximumOffset; offset++) {
        if (url.charCodeAt(offset) === 0x2c) {
            return offset;
        }
    }
    return -1;
}

function decodeImageHeader(url: string, dataStart: number, encodedLength: number): string {
    const prefixLength = Math.min(encodedLength, MAX_ENCODED_IMAGE_HEADER_CHARACTERS);
    return atob(url.slice(dataStart, dataStart + prefixLength));
}

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

function contentHasValue(content: PiInputContent[]): boolean {
    return content.some(block => block.type === 'image' || !isBlank(block.text));
}

function compactTextBlocks(content: PiInputContent[]): PiInputContent[] {
    return content.filter(block => block.type === 'image' || !isBlank(block.text));
}

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

function addNamePrefix(content: PiInputContent[], name: string | undefined): PiInputContent[] {
    const prefix = formatSendingMessageName(name);
    if (!prefix) {
        return content;
    }
    return [{ type: 'text', text: prefix }, ...content];
}

function findNearestUserIndex(messages: readonly SendingMessage[], sourceIndex: number): number {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < messages.length; index++) {
        if (messages[index].role !== 'user') {
            continue;
        }
        const distance = Math.abs(index - sourceIndex);
        if (distance < bestDistance || (distance === bestDistance && index < bestIndex)) {
            bestIndex = index;
            bestDistance = distance;
        }
    }
    return bestIndex;
}

function makeAttachments(): UserAttachments {
    return { before: [], after: [] };
}

function decorateUserContent(
    content: PiInputContent[],
    name: string | undefined,
    attachments: UserAttachments | undefined
): PiInputContent[] {
    const before = (attachments?.before ?? []).map(attachment => ({
        type: 'text' as const,
        text: formatSystemInjection(attachment.text),
    }));
    const after = (attachments?.after ?? []).map(attachment => ({
        type: 'text' as const,
        text: formatSystemInjection(attachment.text),
    }));
    return [...before, ...addNamePrefix(content, name), ...after];
}

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

function handleEmptyMessage(
    mode: ContextAdapterMode,
    sourceIndex: number,
    diagnostics: PiContextAdapterDiagnostics
): false {
    if (mode === 'strict') {
        throw new PiContextAdapterError(
            `第 ${sourceIndex} 条消息内容为空`,
            'empty-content',
            sourceIndex
        );
    }
    diagnostics.droppedEmptyMessageIndexes.push(sourceIndex);
    return false;
}

export function toPiContext(
    input: readonly SendingMessage[],
    options: ToPiContextOptions = {}
): PiContextAdapterResult {
    const mode = options.mode ?? 'lenient';
    const lateSystemPolicy = options.lateSystemPolicy ?? 'attach-to-nearest-user';
    const now = options.now ?? Date.now;
    const messages = Array.from(input);
    const diagnostics: PiContextAdapterDiagnostics = {
        movedLateSystemCount: 0,
        lateSystemMoves: [],
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
            handleEmptyMessage(mode, index, diagnostics);
            continue;
        }
        systemPromptParts.push(text);
    }

    const attachmentsByUserIndex = new Map<number, UserAttachments>();
    for (let index = leadingSystemEnd; index < messages.length; index++) {
        if (messages[index].role !== 'system') {
            continue;
        }
        if (lateSystemPolicy === 'strict') {
            throw new PiContextAdapterError(
                `第 ${index} 条消息是在对话开始后出现的 system 消息`,
                'late-system',
                index
            );
        }
        const text = extractSystemText(messages[index], index);
        if (isBlank(text)) {
            handleEmptyMessage(mode, index, diagnostics);
            continue;
        }
        const targetUserIndex = findNearestUserIndex(messages, index);
        if (targetUserIndex === -1) {
            throw new PiContextAdapterError(
                `第 ${index} 条 system 消息附近没有可附着的 user 消息`,
                'missing-user-for-system',
                index
            );
        }
        const placement = index < targetUserIndex ? 'before' : 'after';
        const attachments = attachmentsByUserIndex.get(targetUserIndex) ?? makeAttachments();
        attachments[placement].push({ sourceIndex: index, text });
        attachmentsByUserIndex.set(targetUserIndex, attachments);
        diagnostics.lateSystemMoves.push({ sourceIndex: index, targetUserIndex, placement });
    }
    diagnostics.movedLateSystemCount = diagnostics.lateSystemMoves.length;

    const piMessages: Message[] = [];
    const toolNamesById = new Map<string, string>();
    const imageBudget: ImageInputBudget = { decodedBytes: 0, imageCount: 0 };
    for (let index = leadingSystemEnd; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === 'system') {
            continue;
        }
        if (message.role === 'user') {
            const content = decorateUserContent(
                convertContent(message.content, index, true, imageBudget),
                message.name,
                attachmentsByUserIndex.get(index)
            );
            if (!contentHasValue(content)) {
                handleEmptyMessage(mode, index, diagnostics);
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
                handleEmptyMessage(mode, index, diagnostics);
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

    return {
        context: {
            ...(systemPromptParts.length > 0
                ? { systemPrompt: systemPromptParts.join('\n\n') }
                : {}),
            messages: piMessages,
        },
        diagnostics,
    };
}
