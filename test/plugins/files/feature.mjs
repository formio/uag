// A plugins file whose default export is a module with a feature, as
// compose() of a feature and its plugins makes it.
export default {
    extra: 'features/notes + documents/notes',
    pluginTypes: [{ type: 'note', title: 'Note', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [] }],
    plugins: [{ type: 'note', name: 'fixture-note', version: '1.0.0', apiVersion: 1 }],
    uag: { name: 'notes', apiVersion: 1 }
};
