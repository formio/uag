import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
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

/** A real dynamic import(), kept one after compilation to CommonJS. */
const dynamicImport: (specifier: string) => Promise<any> = new Function('specifier', 'return import(specifier)') as any;

/**
 * Load the plugins file, if any, and use it, named by its path in error
 * messages: its plugins; or, when its default export declares a feature (a
 * `uag` key, as `compose` of a feature and plugins makes), that module as it
 * is. Plugins are trusted code: they run in the UAG process.
 */
export async function usePluginFiles(server: Pick<UAGServer, 'use'>, env: Record<string, string | undefined> = process.env, defaultFile = DEFAULT_PLUGINS_FILE): Promise<string | undefined> {
    const file = pluginsFile(env, defaultFile);
    if (!file) return undefined;
    const exported = (await dynamicImport(pathToFileURL(file).href))?.default;
    if (exported && typeof exported === 'object' && !Array.isArray(exported) && exported.uag !== undefined) {
        server.use(exported, file);
        console.log(`[formio-uag] Plugins and features loaded from ${file}.`);
        return file;
    }
    const plugins = await loadPluginFile(file);
    server.use({ plugins }, file);
    console.log(`[formio-uag] Plugins loaded from ${file}.`);
    return file;
}
