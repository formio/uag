import { ENGINE_NAME } from '@formio/uag-sdk';
import type { Plugin, PluginRegistry, PluginType } from '@formio/appserver';
import type { UAGProjectInterface } from './UAGProjectInterface';
import { allTools } from './agent/tools';
import { engineTypesOf } from './agent/engines';
import { UAG_VERSION } from './version';

/**
 * Engines and MCP tools, listed in the plugin registry (phase 1). The UAG keeps
 * loading them its own way (UAG_ENGINES, config.tools); the registry only lists
 * them, so they appear in GET {project}/plugins. Settings values are never listed.
 */
export const enginePluginType: PluginType = {
    type: 'engine',
    title: 'Engine',
    apiVersions: [1],
    editForm: 'none',
    // A misconfigured engine stops startup.
    unavailable: 'error',
    registration: 'internal',
    stability: 'stable',
    validate: (plugin: Plugin) => ENGINE_NAME.test(plugin.name) ? [] : [`engine name "${plugin.name}" must be lowercase letters, digits and "-", starting with a letter`],
    manifest: (plugin: Plugin) => ({
        kinds: plugin.kinds,
        accepts: plugin.accepts,
        generate: plugin.generate,
        instances: plugin.instances
    })
};

export const toolPluginType: PluginType = {
    type: 'tool',
    title: 'MCP tool',
    apiVersions: [1],
    editForm: 'none',
    unavailable: 'error',
    registration: 'internal',
    stability: 'stable',
    validate: (plugin: Plugin) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(plugin.name) ? [] : [`tool name "${plugin.name}" must start with a letter and hold only letters, digits, "_" and "-"`],
    manifest: (plugin: Plugin) => ({ annotations: plugin.annotations ?? null })
};

const semver = (version: string | undefined) => (version && /^\d+\.\d+\.\d+/.test(version)) ? version : UAG_VERSION;

/** List each loaded engine type: its instances, kinds, what agent instances read, and whether they generate. */
export function listEngines(registry: PluginRegistry, project: UAGProjectInterface) {
    const engines = project.formflowEngines();
    const entries: Plugin[] = engineTypesOf(engines).map((type) => {
        const instances = type.instances.map((name) => engines.get(name)).filter(Boolean) as any[];
        const agents = instances.filter((engine) => engine.kind === 'agent');
        const accepts = [...new Set(agents.flatMap((engine) => Array.isArray(engine.accepts) ? engine.accepts : ['text']))];
        return {
            type: 'engine',
            name: type.name,
            title: type.title,
            version: semver(type.version),
            apiVersion: 1,
            kinds: type.kinds,
            accepts,
            generate: agents.some((engine) => typeof engine.generate === 'function'),
            instances: type.instances
        };
    });
    registry.addType(enginePluginType, '@formio/uag');
    registry.add(entries, 'UAG_ENGINES', { server: true });
}

/**
 * List every MCP tool the project serves (built-in, then config.tools).
 * allTools() refuses a name defined twice, as the MCP server would.
 */
export async function listTools(registry: PluginRegistry, project: UAGProjectInterface) {
    const entries: Plugin[] = [];
    for (const tool of await allTools(project)) {
        const name = String(tool.name);
        entries.push({
            type: 'tool',
            name,
            title: tool.title || name,
            description: tool.description,
            version: UAG_VERSION,
            apiVersion: 1,
            annotations: tool.annotations
        });
    }
    registry.addType(toolPluginType, '@formio/uag');
    registry.add(entries, 'config.tools', { server: true });
}
