import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadPluginFile } from '@formio/appserver';
import type { UAGServer } from './index';

/** The image's plugins folder: add-ons are mounted in folders under it. */
export const DEFAULT_PLUGINS_DIR = '/app/plugins';

/** The file that makes a folder one plugins folder. */
const INDEX = 'index.mjs';

const isDirectory = (target: string) => {
    try {
        return fs.statSync(target).isDirectory();
    }
    catch {
        return false;
    }
};

/**
 * The plugins files a path holds, in load order:
 * - a file: that file;
 * - a folder with an `index.mjs`: that file alone (one plugins folder);
 * - any other folder: the `index.mjs` of each folder directly in it, in
 *   name order (one per add-on), skipping folders whose name starts with
 *   "." and `node_modules`.
 */
export function pluginFilesIn(target: string): string[] {
    if (!isDirectory(target)) return [target];
    const own = path.join(target, INDEX);
    if (fs.existsSync(own)) return [own];
    return fs.readdirSync(target, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(path.join(target, entry.name))))
        .map((entry) => entry.name)
        .sort()
        .map((name) => path.join(target, name, INDEX))
        .filter((file) => fs.existsSync(file));
}

/**
 * The plugins files to load: those UAG_PLUGINS names (a file, a folder, or
 * "off"), or else those in the image's plugins folder when it exists.
 */
export function pluginFiles(env: Record<string, string | undefined> = process.env, defaultDir = DEFAULT_PLUGINS_DIR): string[] {
    const setting = String(env.UAG_PLUGINS || '').trim();
    if (setting.toLowerCase() === 'off') return [];
    if (setting) return pluginFilesIn(path.resolve(setting));
    return fs.existsSync(defaultDir) ? pluginFilesIn(defaultDir) : [];
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

/** Use one plugins file, named by its path in error messages. */
async function usePluginFile(server: Pick<UAGServer, 'use'>, file: string): Promise<void> {
    const exported = (await dynamicImport(pathToFileURL(file).href))?.default;
    const entries = ([] as any[]).concat(exported ?? []);
    if (entries.some(isModule)) {
        const plugins = entries.filter((entry) => !isModule(entry));
        server.use([...entries.filter(isModule), ...(plugins.length ? [{ plugins }] : [])], file);
        console.log(`[formio-uag] Plugins and modules loaded from ${file}.`);
        return;
    }
    const plugins = await loadPluginFile(file);
    server.use({ plugins }, file);
    console.log(`[formio-uag] Plugins loaded from ${file}.`);
}

/**
 * Load the plugins files, if any, and use each in turn, named by its path in
 * error messages. A file's default export is a plugin or a list of plugins;
 * or a module (an extra, with its plugins), or a list mixing modules and
 * plugins, each module used in turn. Several files merge as several modules
 * do: a module used again by name is used once, and two files that register
 * the same plugin, plugin type, route or component stop startup, naming both.
 * Plugins are trusted code: they run in the UAG process. Returns the files
 * loaded.
 */
export async function usePluginFiles(server: Pick<UAGServer, 'use'>, env: Record<string, string | undefined> = process.env, defaultDir = DEFAULT_PLUGINS_DIR): Promise<string[]> {
    const files = pluginFiles(env, defaultDir);
    for (const file of files) await usePluginFile(server, file);
    return files;
}
