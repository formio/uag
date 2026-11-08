// Another add-on, loaded first (by name): its own copy of the same module, used once, and a
// plugin of the type that module defines.
import { notes } from '../notes.mjs';
export default [notes(), { type: 'note', name: 'crm-note', title: 'CRM note', version: '1.0.0', apiVersion: 1 }];
