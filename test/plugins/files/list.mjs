// A plugins file whose default export lists modules and a bare plugin.
export default [
    { name: 'notes', apiVersion: 1, initialize() {} },
    { name: 'notes-plugins', plugins: [{ type: 'note', name: 'fixture-note', version: '1.0.0', apiVersion: 1 }] },
    { type: 'converter', name: 'loose-converter', version: '1.0.0', apiVersion: 1 },
    // A plugin with its type misspelled is still a plugin, for the registry to refuse.
    { typ: 'converter', name: 'typo', version: '1.0.0', apiVersion: 1 }
];
