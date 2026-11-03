// A plugins file, as a deployment mounts one: a converter for a made-up format.
export default [{
    type: 'converter',
    name: 'fixture-text',
    title: 'Fixture text',
    version: '1.0.0',
    apiVersion: 1,
    accepts: [{ type: 'application/x-fixture', ext: ['.fixture'] }],
    produces: ['text'],
    detect: (head) => head.subarray(0, 8).toString() === 'FIXTURE\n' ? 'application/x-fixture' : null,
    convert: async ({ buffer }) => ({ text: buffer.subarray(8).toString(), textFormat: 'plain' })
}];
