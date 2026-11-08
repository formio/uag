// An add-on's plugins folder: a module that defines the "note" plugin type, and a plugin of it.
import { notes } from '../notes.mjs';
export default [notes(), { type: 'note', name: 'documents-note', title: 'Documents note', version: '1.0.0', apiVersion: 1 }];
