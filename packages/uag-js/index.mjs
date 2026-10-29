// The ES module entry: the same module as index.js, which is CommonJS (and a browser global).
import uag from './index.js';

export const { UAG, attach, uagFormUrl, routingPlugin, ExtractionState, SSEParser, isEmpty } = uag;
export default uag;
