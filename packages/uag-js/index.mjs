// The ES module entry: the same module as index.js, which is CommonJS (and a browser global).
import uag from './index.js';

export const { UAG, attach, createChat, uagFormUrl, routingPlugin, ExtractionState, SSEParser, isEmpty, CHAT_TEMPLATES } = uag;
export default uag;
