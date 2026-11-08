// Two add-ons that both register converter:same.
export default [{
    type: 'converter',
    name: 'same',
    title: 'Same',
    version: '1.0.0',
    apiVersion: 1,
    accepts: [{ type: 'application/x-same', ext: ['.same'] }],
    produces: ['text'],
    convert: async ({ buffer }) => ({ text: buffer.toString(), textFormat: 'plain' })
}];
