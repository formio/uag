// A plugins file whose default export is a module: a module with its own plugin type and plugins.
export default {
    name: 'notes',
    apiVersion: 1,
    pluginTypes: [{ type: 'note', title: 'Note', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [] }],
    plugins: [{ type: 'note', name: 'fixture-note', version: '1.0.0', apiVersion: 1 }],
    initialize() {}
};
