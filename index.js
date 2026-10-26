// The UAG as the Docker image runs it: with the module in ./module, which a
// deployment can replace by mounting its own (see demo/samples/custom-module).
const { start, fail } = require('./bin/uag');
start(require('./module')).catch(fail);
