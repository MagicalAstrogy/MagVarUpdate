/** 连接与方案仅保存服务商到集中凭证记录的引用，不复制会轮换的 refresh token。 */
export type PiCredentialReferences = Record<string, string>;

/** 接受旧版服务商键和带服务商命名空间的新凭证编号，拒绝跨服务商引用。 */
export function isPiCredentialId(providerId: string, credentialId: string): boolean {
    return (
        credentialId === providerId ||
        credentialId.startsWith(`oauth:${encodeURIComponent(providerId)}:`)
    );
}

/** 规范显式引用；缺少字段的旧设置才从原 providerId 记录一次性继承登录态。 */
export function resolvePiCredentialReferences(
    pi: { credentialIds?: unknown },
    credentials: Record<string, unknown> = {}
): PiCredentialReferences {
    if (pi.credentialIds !== undefined) {
        if (
            typeof pi.credentialIds !== 'object' ||
            pi.credentialIds === null ||
            Array.isArray(pi.credentialIds)
        ) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(pi.credentialIds).filter(
                ([providerId, id]) => typeof id === 'string' && isPiCredentialId(providerId, id)
            )
        );
    }
    return Object.fromEntries(
        Object.entries(credentials)
            .filter(
                ([id, value]) =>
                    !id.startsWith('oauth:') &&
                    typeof value === 'object' &&
                    value !== null &&
                    (value as { type?: unknown }).type === 'oauth'
            )
            .map(([providerId]) => [providerId, providerId])
    );
}
