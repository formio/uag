// The ES module entry: the same module as index.js, which is CommonJS (and a browser global).
import uag from './index.js';

export const { UAG, attach, createChat, uagFormUrl, routingPlugin, ExtractionState, SSEParser, isEmpty, CHAT_TEMPLATES, renderMarkdown, normalizeDefinition, documentComponentFor } = uag;
// The AI Document component class is built on the formio.js it is registered with: `UAG.UAGDocument` once `Formio.use(UAG(...))` ran.
export default uag;
