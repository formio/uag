// A module each add-on brings its own copy of: a new object each time, of the same name and version.
export const notes = () => ({
    name: 'notes',
    version: '1.0.0',
    apiVersion: 1,
    pluginTypes: [{ type: 'note', title: 'Note', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [] }],
    initialize() {}
});
