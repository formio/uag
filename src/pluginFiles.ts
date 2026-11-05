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
 * The keys only a module has: an entry with one of them (and no plugin `type`)
 * is a module, anything else a plugin. Plugins have a `name` and `settings`
 * too, so a name says nothing, and `settings` counts only as a function.
 * (`uag` too, so a module written for the old shape is refused saying what to
 * change, not read as a plugin.)
 */
const MODULE_KEYS = ['uag', 'routes', 'components', 'initialize', 'plugins', 'pluginTypes', 'config', 'formRoutes', 'actions', 'hooks', 'providers', 'processors'];
const isModule = (entry: any) => !!entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.type !== 'string'
    && (MODULE_KEYS.some((key) => key in entry) || typeof entry.settings === 'function');

/**
 * Load the plugins file, if any, and use it, named by its path in error
 * messages. Its default export is a plugin or a list of plugins; or a module
 * (an extra, with its plugins), or a list mixing modules and
 * plugins, each module used in turn. Plugins are trusted code: they run in
 * the UAG process.
 */
export async function usePluginFiles(server: Pick<UAGServer, 'use'>, env: Record<string, string | undefined> = process.env, defaultFile = DEFAULT_PLUGINS_FILE): Promise<string | undefined> {
    const file = pluginsFile(env, defaultFile);
    if (!file) return undefined;
    const exported = (await dynamicImport(pathToFileURL(file).href))?.default;
    const entries = ([] as any[]).concat(exported ?? []);
    if (entries.some(isModule)) {
        const plugins = entries.filter((entry) => !isModule(entry));
        server.use([...entries.filter(isModule), ...(plugins.length ? [{ plugins }] : [])], file);
        console.log(`[formio-uag] Plugins and modules loaded from ${file}.`);
        return file;
    }
    const plugins = await loadPluginFile(file);
    server.use({ plugins }, file);
    console.log(`[formio-uag] Plugins loaded from ${file}.`);
    return file;
}
