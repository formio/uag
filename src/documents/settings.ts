import type { UAGDocumentsConfig } from '../config';

export type DocumentsSettings = Required<Omit<UAGDocumentsConfig, 'engine'>> & { engine?: string };

const MB = 1024 * 1024;

/** The provider limits the UAG's document limits stay within: 32 MB per request, 600 PDF pages. */
export const PROVIDER_LIMITS = { maxTotalBytes: 32 * MB, maxPages: 600 };

export const DOCUMENTS_DEFAULTS: DocumentsSettings = {
    maxFileBytes: 25 * MB,
    maxFiles: 10,
    maxTotalBytes: 32 * MB,
    maxPages: 500,
    maxTextChars: 2000000,
    timeoutMs: 600000,
    heartbeatMs: 15000,
    perUser: 3,
    prefer: {}
};

const positive = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
};

/** `config.documents` with its defaults and environment variables applied. Configuration wins over the environment. */
export function documentsSettings(config: UAGDocumentsConfig | undefined, env: Record<string, string | undefined> = process.env): DocumentsSettings {
    const given = config || {};
    const pick = (key: keyof DocumentsSettings, variable?: string) =>
        positive((given as any)[key]) ?? (variable ? positive(env[variable]) : undefined) ?? (DOCUMENTS_DEFAULTS as any)[key];
    return {
        maxFileBytes: pick('maxFileBytes', 'DOCUMENTS_MAX_FILE_BYTES'),
        maxFiles: pick('maxFiles'),
        maxTotalBytes: pick('maxTotalBytes'),
        maxPages: pick('maxPages', 'DOCUMENTS_MAX_PAGES'),
        maxTextChars: pick('maxTextChars'),
        timeoutMs: pick('timeoutMs', 'DOCUMENTS_TIMEOUT_MS'),
        heartbeatMs: pick('heartbeatMs'),
        perUser: pick('perUser'),
        prefer: { ...(given.prefer || {}) },
        ...((given.engine || env.DOCUMENTS_ENGINE) && { engine: String(given.engine || env.DOCUMENTS_ENGINE) })
    };
}

/** Warnings for limits beyond what the engines' providers take: logged at startup. */
export function documentLimitWarnings(settings: DocumentsSettings): string[] {
    const warnings: string[] = [];
    if (settings.maxTotalBytes > PROVIDER_LIMITS.maxTotalBytes) {
        warnings.push(`documents.maxTotalBytes (${settings.maxTotalBytes}) is above the ${PROVIDER_LIMITS.maxTotalBytes} bytes an engine provider takes in one request; larger requests will fail.`);
    }
    if (settings.maxPages > PROVIDER_LIMITS.maxPages) {
        warnings.push(`documents.maxPages (${settings.maxPages}) is above the ${PROVIDER_LIMITS.maxPages} PDF pages an engine provider reads in one request; larger documents will fail.`);
    }
    return warnings;
}
