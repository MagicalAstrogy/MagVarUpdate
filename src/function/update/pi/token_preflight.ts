import type { Context, ImageContent, Message } from '@earendil-works/pi-ai';
import { getPiImageMetadata, PI_IMAGE_INPUT_LIMITS } from './context_adapter';

export type PiTokenPreflightResult = {
    estimatedInputTokens: number;
    reservedTokens: number;
    maxInputTokens: number;
};

const MIN_IMAGE_TOKEN_ESTIMATE = 1024;
const ESTIMATED_IMAGE_BYTES_PER_TOKEN = 64;
// Common multimodal APIs estimate image tokens from tiled/pixel area. Using a
// lower pixels-per-token ratio leaves deliberate cross-provider headroom.
const ESTIMATED_IMAGE_PIXELS_PER_TOKEN = 500;

/**
 * 按 UTF-8 字节保守估算文本 token，兼顾中文与非基本平面字符。
 * 这是发送前的预算保护，不用于精确计费。
 */
function estimateTextTokens(value: string): number {
    if (!value) {
        return 0;
    }
    // This is a deliberately conservative boundary guard, not billing-grade
    // tokenization. UTF-8 bytes avoid undercounting CJK and astral characters
    // while ASCII/JSON remains cheaper than non-ASCII text.
    let ascii_bytes = 0;
    let non_ascii_bytes = 0;
    for (const character of value) {
        const code_point = character.codePointAt(0)!;
        if (code_point <= 0x7f) {
            ascii_bytes += 1;
        } else if (code_point <= 0x7ff) {
            non_ascii_bytes += 2;
        } else if (code_point <= 0xffff) {
            non_ascii_bytes += 3;
        } else {
            non_ascii_bytes += 4;
        }
    }
    return Math.ceil(ascii_bytes / 3 + non_ascii_bytes / 2);
}

/** 根据 Base64 长度与填充估算解码字节数，避免为预算检查复制或解码整张图片。 */
function estimateDecodedBase64Bytes(data: string): number {
    if (!data) {
        return 0;
    }
    // Adapter-produced blocks are canonical base64. Counting whitespace in an
    // external block overestimates safely and avoids an image-sized copy.
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** 优先使用上下文转换时记录的图片大小，外部内容块再按 Base64 长度估算。 */
function getEstimatedImageBytes(image: ImageContent): number {
    return getPiImageMetadata(image)?.decodedBytes ?? estimateDecodedBase64Bytes(image.data);
}

/** 取图片最小预算、字节估算和像素面积估算中的最大值，保留跨服务商余量。 */
function estimateImageTokens(image: ImageContent): number {
    const metadata = getPiImageMetadata(image);
    const estimated_bytes = getEstimatedImageBytes(image);
    const dimensions = metadata?.dimensions;

    let pixel_tokens = 0;
    if (
        dimensions !== undefined &&
        Number.isSafeInteger(dimensions.width) &&
        dimensions.width > 0 &&
        Number.isSafeInteger(dimensions.height) &&
        dimensions.height > 0
    ) {
        pixel_tokens = Math.ceil(
            (dimensions.width * dimensions.height) / ESTIMATED_IMAGE_PIXELS_PER_TOKEN
        );
    }

    return Math.max(
        MIN_IMAGE_TOKEN_ESTIMATE,
        Math.ceil(estimated_bytes / ESTIMATED_IMAGE_BYTES_PER_TOKEN),
        pixel_tokens
    );
}

/** 检查单图、总图片数量和累计解码大小，即使外部绕过上下文转换也执行预算限制。 */
function assertPiImageInputBudget(context: Context): void {
    let image_count = 0;
    let decoded_bytes = 0;
    /** 累计单个图片块并立即检查各项图片限制，超限时停止遍历。 */
    const countImage = (image: ImageContent): void => {
        const image_bytes = getEstimatedImageBytes(image);
        if (image_bytes > PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerImage) {
            throw new Error('More source image exceeds the per-image input limit');
        }
        image_count += 1;
        decoded_bytes += image_bytes;
        if (image_count > PI_IMAGE_INPUT_LIMITS.maxImagesPerContext) {
            throw new Error('More source image count exceeds the per-context input limit');
        }
        if (decoded_bytes > PI_IMAGE_INPUT_LIMITS.maxDecodedBytesPerContext) {
            throw new Error('More source image total exceeds the per-context input limit');
        }
    };

    for (const message of context.messages) {
        if (message.role === 'user' && Array.isArray(message.content)) {
            for (const block of message.content) {
                if (block.type === 'image') {
                    countImage(block);
                }
            }
        } else if (message.role === 'toolResult') {
            for (const block of message.content) {
                if (block.type === 'image') {
                    countImage(block);
                }
            }
        }
    }
}

/** 按消息角色估算文本、思考、工具参数和图片，并计入消息结构开销。 */
function estimateMessageTokens(message: Message): number {
    let tokens = 6;
    if (message.role === 'user') {
        if (typeof message.content === 'string') {
            return tokens + estimateTextTokens(message.content);
        }
        for (const block of message.content) {
            tokens +=
                block.type === 'text' ? estimateTextTokens(block.text) : estimateImageTokens(block);
        }
        return tokens;
    }
    if (message.role === 'assistant') {
        for (const block of message.content) {
            if (block.type === 'text') {
                tokens += estimateTextTokens(block.text);
            } else if (block.type === 'thinking') {
                tokens += estimateTextTokens(block.thinking);
            } else {
                tokens +=
                    estimateTextTokens(block.name) +
                    estimateTextTokens(JSON.stringify(block.arguments));
            }
        }
        return tokens;
    }
    for (const block of message.content) {
        tokens +=
            block.type === 'text' ? estimateTextTokens(block.text) : estimateImageTokens(block);
    }
    return tokens + estimateTextTokens(message.toolName);
}

/** 汇总系统提示词、历史消息和工具定义的输入 token 估算。 */
export function estimatePiContextTokens(context: Context): number {
    let tokens = estimateTextTokens(context.systemPrompt ?? '');
    for (const message of context.messages) {
        tokens += estimateMessageTokens(message);
    }
    if (context.tools?.length) {
        tokens += estimateTextTokens(JSON.stringify(context.tools));
    }
    return Math.max(1, tokens);
}

/**
 * 预留回复 token 和安全余量后检查完整输入预算，不在此截断提示词。
 * 同时校验图片限制；超限错误携带估算明细，供界面解释原因。
 */
export function assertPiTokenBudget(
    context: Context,
    context_window: number,
    max_tokens: number,
    reserve_ratio = 0.07
): PiTokenPreflightResult {
    if (!Number.isInteger(context_window) || context_window <= 0) {
        throw new Error('More source contextWindow must be a positive integer');
    }
    if (!Number.isInteger(max_tokens) || max_tokens <= 0) {
        throw new Error('More source maxTokens must be a positive integer');
    }
    if (max_tokens > context_window) {
        throw new Error('More source maxTokens must not exceed contextWindow');
    }
    assertPiImageInputBudget(context);

    const normalized_reserve_ratio = Math.min(0.1, Math.max(0.05, reserve_ratio));
    const reserved_tokens = Math.ceil(context_window * normalized_reserve_ratio);
    const max_input_tokens = context_window - max_tokens - reserved_tokens;
    const estimated_input_tokens = estimatePiContextTokens(context);
    if (max_input_tokens <= 0 || estimated_input_tokens > max_input_tokens) {
        throw new Error(
            `More source prompt is too long: estimated ${estimated_input_tokens} input tokens, ` +
                `limit ${Math.max(0, max_input_tokens)} after reserving ${max_tokens} reply tokens ` +
                `and ${reserved_tokens} safety tokens`
        );
    }

    return {
        estimatedInputTokens: estimated_input_tokens,
        reservedTokens: reserved_tokens,
        maxInputTokens: max_input_tokens,
    };
}
