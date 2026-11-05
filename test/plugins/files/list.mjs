// A plugins file whose default export lists modules (a feature, an extra) and a bare plugin.
export default [
    { extra: 'features/notes', uag: { name: 'notes', apiVersion: 1 } },
    { extra: 'documents/notes', plugins: [{ type: 'note', name: 'fixture-note', version: '1.0.0', apiVersion: 1 }] },
    { type: 'converter', name: 'loose-converter', version: '1.0.0', apiVersion: 1 },
    // A plugin with its type misspelled is still a plugin, for the registry to refuse.
    { typ: 'converter', name: 'typo', version: '1.0.0', apiVersion: 1 }
];
