import fs from 'fs';
import path from 'path';
import { loadPluginFile } from '@formio/appserver';
import type { UAGServer } from './index';

/** Where the curated image keeps its plugins file. */
export const DEFAULT_PLUGINS_FILE = '/app/plugins/index.mjs';

/**
 * The plugins file to load: UAG_PLUGINS (a path, or "off"), or else the
 * image's default when it exists. Undefined when there is none.
 */
export function pluginsFile(env: Record<string, string | undefined> = process.env, defaultFile = DEFAULT_PLUGINS_FILE): string | undefined {
    const setting = String(env.UAG_PLUGINS || '').trim();
    if (setting.toLowerCase() === 'off') return undefined;
    if (setting) return path.resolve(setting);
    return fs.existsSync(defaultFile) ? defaultFile : undefined;
}

/**
 * Load the plugins file, if any, and use its plugins, named by its path in
 * error messages. Plugins are trusted code: they run in the UAG process.
 */
export async function usePluginFiles(server: Pick<UAGServer, 'use'>, env: Record<string, string | undefined> = process.env, defaultFile = DEFAULT_PLUGINS_FILE): Promise<string | undefined> {
    const file = pluginsFile(env, defaultFile);
    if (!file) return undefined;
    const plugins = await loadPluginFile(file);
    server.use({ plugins }, file);
    console.log(`[formio-uag] Plugins loaded from ${file}.`);
    return file;
}
