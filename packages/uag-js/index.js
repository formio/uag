/**
 * @formio/uag-js: the Form.io UAG for formio.js applications.
 *
 *   import { Formio } from '@formio/js';
 *   import { UAG } from '@formio/uag-js';
 *   Formio.use(UAG('https://uag.example.com'));
 *   Formio.createForm(element, 'https://forms.example.com/myproject/claim');
 *
 * Registered once, it sends the submission requests of every form tagged `uag`
 * to the UAG (so the form's Run task actions run), and attaches Agent Input to
 * those whose task has an input (`uag: "<task>"`, `uagField: "input"`). Every
 * other request, and every other form, goes to Form.io as before.
 *
 * Agent Input calls the form's own agent operations on the UAG
 * (`{form}/agent/extract`) with the user's Form.io token, applies each engine's
 * results as they stream in (so the form's conditionals react to fast
 * decisions first), and never overwrites a value the user entered or changed.
 *
 * Works as an ES module, a CommonJS module, or the browser global `FormioUAG`.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    }
    else {
        root.FormioUAG = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function isEmpty(value) {
        if (value === undefined || value === null || value === '' || value === false) return true;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return !Object.keys(value).some(function (key) { return value[key]; });
        return false;
    }

    function same(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /**
     * Where each field's value came from. A value may be written by extraction
     * only when the field is empty, or when its current value is the one
     * extraction wrote last and the user has not touched it since.
     */
    function ExtractionState() {
        this.agentValues = {};
        this.userEdited = {};
    }
    ExtractionState.prototype.canApply = function (path, currentValue) {
        if (this.userEdited[path]) return false;
        if (isEmpty(currentValue)) return true;
        return Object.prototype.hasOwnProperty.call(this.agentValues, path) && same(this.agentValues[path], currentValue);
    };
    ExtractionState.prototype.recordAgent = function (path, value) {
        this.agentValues[path] = value;
    };
    ExtractionState.prototype.recordUser = function (path) {
        this.userEdited[path] = true;
        delete this.agentValues[path];
    };
    ExtractionState.prototype.source = function (path) {
        if (this.userEdited[path]) return 'user';
        return Object.prototype.hasOwnProperty.call(this.agentValues, path) ? 'agent' : 'none';
    };

    /**
     * Incremental Server-Sent Events parser. Feed it text chunks; it calls
     * `onEvent(name, data)` for each complete event.
     */
    function SSEParser(onEvent) {
        this.buffer = '';
        this.onEvent = onEvent;
    }
    SSEParser.prototype.push = function (chunk) {
        this.buffer += chunk;
        var parts = this.buffer.split('\n\n');
        this.buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
            var name = 'message';
            var data = '';
            var lines = parts[i].split('\n');
            for (var j = 0; j < lines.length; j++) {
                if (lines[j].indexOf('event: ') === 0) name = lines[j].slice(7);
                else if (lines[j].indexOf('data: ') === 0) data += lines[j].slice(6);
            }
            if (data) {
                try {
                    this.onEvent(name, JSON.parse(data));
                }
                catch (err) {
                    // A malformed event is skipped; the final "done" event still completes the request.
                }
            }
        }
    };

    /** A real DOM, not a server-side shim without createElement. */
    function hasDom() {
        return typeof document !== 'undefined' && typeof document.createElement === 'function';
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function pct(value) {
        return Math.round(value * 100) + '%';
    }

    /** What `UAG()` registered: the UAG's URL, the formio.js it was given, and its options. */
    var registered = { uagUrl: '', Formio: null, options: {} };

    function trimSlash(url) {
        return String(url || '').replace(/\/+$/, '');
    }

    /** Whether a form definition is tagged `uag`. */
    function isUagForm(definition) {
        return !!(definition && Array.isArray(definition.tags) && definition.tags.indexOf('uag') !== -1);
    }

    /**
     * A form's URL on the UAG, by id: under the project's id when the form has
     * one (Enterprise and the hosted service), else at the UAG's root (Open Source).
     */
    function uagFormUrl(uagUrl, definition) {
        if (!uagUrl || !definition || !definition._id) return '';
        var project = definition.project ? '/project/' + encodeURIComponent(String(definition.project)) : '';
        return trimSlash(uagUrl) + project + '/form/' + encodeURIComponent(String(definition._id));
    }

    /** The user's Form.io token, as formio.js holds it. */
    function formioToken(form) {
        var sdk = registered.Formio;
        try {
            if (form && form.formio && typeof form.formio.getToken === 'function') return form.formio.getToken();
            if (sdk && typeof sdk.getToken === 'function') return sdk.getToken();
        }
        catch (err) {
            return null;
        }
        return null;
    }

    /** Find the task's input components in a rendered form. */
    function findInputs(form, task) {
        var inputs = [];
        form.everyComponent(function (component) {
            var props = (component.component && component.component.properties) || {};
            if (props.uagField === 'input' && props.uag && (!task || props.uag === task)) {
                inputs.push(component);
            }
        });
        return inputs;
    }

    function pathOf(component) {
        return component.path || component.key || (component.component && component.component.key);
    }

    /** The task an input component belongs to (its `uag` property). */
    function taskOfInput(component) {
        var props = (component && component.component && component.component.properties) || {};
        return props.uag || undefined;
    }

    /**
     * Attach Agent Input to a rendered form. Returns a controller with
     * `extract()` (run now) and `detach()`. Attaching again replaces the form's
     * earlier attachment, so the form never extracts twice.
     */
    function attach(form, options) {
        options = options || {};
        if (form.uagAgent && typeof form.uagAgent.detach === 'function') form.uagAgent.detach();
        var fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
        var state = new ExtractionState();
        var trigger = options.trigger || 'blur';
        var pauseMs = options.pauseMs || 800;
        var nextTimeoutMs = options.nextTimeoutMs || 1500;
        var task = options.task;
        // Where the form's agent operations are: the form on the UAG, or a relay of your own.
        var formUrl = trimSlash(options.formUrl || uagFormUrl(options.uagUrl || registered.uagUrl, form.form));
        var applying = false;
        var lastInputKey = null;
        var inflight = null;
        var timer = null;
        var cleanups = [];
        var annotations = [];
        var noted = {};

        // Remember fields the user changes, so extraction never overwrites them.
        var onChange = function (event, flags, modified) {
            if (applying || !modified || !event || !event.changed) return;
            var instance = event.changed.instance || event.changed.component;
            var path = instance && (instance.path || instance.key);
            if (path) state.recordUser(path);
        };
        form.on('change', onChange);
        cleanups.push(function () { if (form.off) form.off('change', onChange); });

        function clearAnnotations() {
            annotations.forEach(function (node) { if (node.parentNode) node.parentNode.removeChild(node); });
            annotations = [];
            noted = {};
        }

        function annotate(component, result) {
            if (!component) return;
            // Remembered, so a field on a page drawn later is annotated then.
            var path = result.path || pathOf(component);
            noted[path] = { result: result, node: null };
            if (!component.element || !hasDom()) return;
            var note;
            if (result.status === 'confident') {
                note = el('span', 'uag-chip uag-confident', 'Filled from your description' + (result.confidence !== undefined ? ' (' + pct(result.confidence) + ' sure)' : ''));
            }
            else if (result.status === 'uncertain') {
                // An uncertain value can still have a high choice confidence (for
                // example when the input may not address the question at all), so
                // no percentage here; unlikely alternatives are left out.
                note = el('div', 'uag-chip uag-uncertain', 'Please check this. ');
                (result.alternatives || []).filter(function (alt) { return !(alt.confidence < 0.05); }).forEach(function (alt) {
                    var button = el('button', 'uag-alternative', alt.label + ' ' + pct(alt.confidence));
                    button.type = 'button';
                    button.addEventListener('click', function () {
                        component.setValue(alt.value);
                        state.recordUser(result.path);
                    });
                    note.appendChild(button);
                });
            }
            else if (result.status === 'suggested') {
                note = el('span', 'uag-chip uag-suggested', 'Suggested from your description. Please check it.');
            }
            if (note) {
                component.element.appendChild(note);
                annotations.push(note);
                noted[path].node = note;
            }
        }

        /** Annotate fields drawn since their results arrived, such as a wizard's later pages. */
        function reannotate() {
            Object.keys(noted).forEach(function (path) {
                var entry = noted[path];
                if (state.source(path) === 'user') return;
                var component = form.getComponent(path);
                if (!component || !component.element) return;
                if (entry.node && component.element.contains && component.element.contains(entry.node)) return;
                annotate(component, entry.result);
            });
        }
        form.on('render', reannotate);
        cleanups.push(function () { if (form.off) form.off('render', reannotate); });

        function showError(message, forTask) {
            if (!hasDom()) return;
            var anchor = findInputs(form, forTask || task)[0];
            var host = anchor && anchor.element;
            if (!host) return;
            var note = el('div', 'uag-error', message);
            note.setAttribute('role', 'status');
            host.appendChild(note);
            annotations.push(note);
        }

        /** Apply one engine's results: values the user has not touched, then annotations. */
        function applyResult(event) {
            var fields = event.fields || {};
            var patch = event.patch || {};
            var applied = 0;
            applying = true;
            try {
                Object.keys(patch).forEach(function (path) {
                    var component = form.getComponent(path);
                    if (!component) return;
                    if (!state.canApply(path, component.getValue())) return;
                    component.setValue(patch[path]);
                    // What the field holds after formio.js normalizes it (select boxes,
                    // dates), so it is still recognized as extraction's own value later.
                    var written = component.getValue();
                    state.recordAgent(path, written === undefined ? patch[path] : written);
                    applied++;
                });
            }
            finally {
                applying = false;
            }
            Object.keys(fields).forEach(function (path) {
                var result = fields[path];
                if (result.status === 'missing' || state.source(path) === 'user') return;
                annotate(form.getComponent(path), result);
            });
            if (options.onResult) options.onResult(event);
            return applied;
        }

        /** The input's current value, to tell when it has changed. */
        function inputKey() {
            return JSON.stringify(inputs.map(function (input) { return input.getValue ? input.getValue() : null; }));
        }

        /**
         * Empty the values extraction wrote from an earlier input that the user
         * has not changed since, so the new input is answered from scratch.
         */
        function resetAgentValues() {
            applying = true;
            try {
                Object.keys(state.agentValues).forEach(function (path) {
                    var component = form.getComponent(path);
                    if (component && state.canApply(path, component.getValue())) {
                        component.setValue(component.emptyValue !== undefined ? component.emptyValue : '');
                    }
                    delete state.agentValues[path];
                });
            }
            finally {
                applying = false;
            }
        }

        /**
         * Call /agent/extract and apply results as they arrive. Resolves when
         * the first decision results have been applied (`decided`) and when
         * the whole request is done (`done`). When the decisions show fields
         * the form was hiding, a follow-up request fills them before `done`.
         * `requestTask` is the task to run: the configured one, else the task
         * of the input that triggered it (none: every task with an input).
         */
        function run(followUp, requestTask) {
            followUp = followUp === true;
            if (inflight && inflight.abort) inflight.abort();
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            inflight = controller;
            if (!followUp) {
                clearAnnotations();
                var key = inputKey();
                if (lastInputKey !== null && key !== lastInputKey) resetAgentValues();
                lastInputKey = key;
            }
            if (options.onStart) options.onStart({ followUp: followUp });
            var decidedValues = 0;
            var summary = null;
            var aborted = false;
            var resolveDecided;
            var decided = new Promise(function (resolve) { resolveDecided = resolve; });
            var headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
            var done = Promise.resolve().then(function () {
                if (!fetchImpl) throw new Error('Filling in from your description is unavailable: fetch is not available.');
                if (!formUrl) throw new Error('Filling in from your description is unavailable: the UAG does not know this form.');
                var token = formioToken(form);
                if (token) headers['x-jwt-token'] = token;
                return fetchImpl(formUrl + '/agent/extract', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ task: requestTask, data: (form.submission && form.submission.data) || {} }),
                    signal: controller ? controller.signal : undefined
                });
            }).then(function (response) {
                if (!response.ok) throw new Error('Filling in from your description is unavailable right now (' + response.status + ').');
                var parser = new SSEParser(function (name, data) {
                    if (name === 'result') {
                        var applied = applyResult(data);
                        if (data.kind === 'decision') {
                            decidedValues += applied;
                            resolveDecided();
                        }
                    }
                    else if (name === 'done') {
                        summary = data;
                    }
                    else if (name === 'error') {
                        // A group whose engines all failed (with its `kind`), or a
                        // failure that ended the request (without one).
                        var failure = new Error(data.kind
                            ? 'Some fields could not be filled from your description. You can fill them in by hand.'
                            : (data.error || 'Filling in from your description failed. You can continue by hand.'));
                        failure.event = data;
                        showError(failure.message, requestTask);
                        if (options.onError) options.onError(failure);
                    }
                });
                if (response.body && response.body.getReader) {
                    var reader = response.body.getReader();
                    var decoder = new TextDecoder();
                    var pump = function () {
                        return reader.read().then(function (chunk) {
                            if (chunk.done) return;
                            parser.push(decoder.decode(chunk.value, { stream: true }));
                            return pump();
                        });
                    };
                    return pump();
                }
                return response.text().then(function (text) { parser.push(text + '\n\n'); });
            }).catch(function (err) {
                if (err && err.name === 'AbortError') {
                    aborted = true;
                    return;
                }
                showError(err && err.message ? err.message : 'Filling in from your description failed. You can continue by hand.', requestTask);
                if (options.onError) options.onError(err);
            }).then(function () {
                resolveDecided();
                if (inflight === controller) inflight = null;
                if (aborted) return;
                if (options.onDone) options.onDone(summary, { followUp: followUp });
                var revealed = !followUp && decidedValues > 0 && summary && (summary.excluded || []).some(function (entry) {
                    return /hidden/.test(entry.reason);
                });
                if (revealed) return run(true, requestTask).done;
            });
            return { decided: decided, done: done };
        }

        /** Run now, for the configured task (none: every task with an input). */
        function extract() {
            return run(false, task);
        }

        // Triggers.
        var inputs = findInputs(form, task);
        // formio.js emits `blur` and `change` on the form with the component
        // instance, so the triggers listen there for the task's inputs.
        var inputPaths = inputs.map(pathOf);
        /** The input a component path is, or is inside of. */
        var inputAt = function (path) {
            for (var i = 0; i < inputs.length; i++) {
                if (path === inputPaths[i] || path.indexOf(inputPaths[i] + '.') === 0) return inputs[i];
            }
            return null;
        };
        var isInputPath = function (path) { return !!inputAt(path); };
        var taskAt = function (path) { return task || taskOfInput(inputAt(path)); };
        if (trigger === 'blur') {
            var onBlur = function (instance) {
                if (instance && isInputPath(pathOf(instance))) run(false, taskAt(pathOf(instance)));
            };
            form.on('blur', onBlur);
            cleanups.push(function () { if (form.off) form.off('blur', onBlur); });
        }
        else if (trigger === 'pause') {
            var onTyping = function (event, flags, modified) {
                var instance = event && event.changed && (event.changed.instance || event.changed.component);
                if (!modified || !instance || !isInputPath(pathOf(instance))) return;
                var typedTask = taskAt(pathOf(instance));
                clearTimeout(timer);
                timer = setTimeout(function () { run(false, typedTask); }, pauseMs);
            };
            form.on('change', onTyping);
            cleanups.push(function () { if (form.off) form.off('change', onTyping); });
        }
        else if (trigger === 'next') {
            // Wait for decision results (bounded) before the wizard moves on, so
            // conditional pages reflect the triage.
            form.options = form.options || {};
            // formio.js copies options shallowly, so the hooks object may be shared
            // with other forms: this form gets its own.
            var originalHooks = form.options.hooks;
            var hooks = Object.assign({}, originalHooks);
            var previous = hooks.beforeNext;
            // formio.js calls beforeNext(currentPage, submission, next) on the form.
            hooks.beforeNext = function (currentPage, submission, next) {
                var self = this;
                var advance = function () {
                    // The inputs on the page being left; none, when the pages are unknown.
                    var onPage = inputs.filter(function (input) {
                        return input.page === undefined || form.page === undefined || input.page === form.page;
                    });
                    if (!onPage.length) return next();
                    var pending = run(false, task || taskOfInput(onPage[0]));
                    var timeout = new Promise(function (resolve) { setTimeout(resolve, nextTimeoutMs); });
                    Promise.race([pending.decided, timeout]).then(function () {
                        // formio.js debounces change handling, so conditional pages would
                        // not reflect the results yet when the wizard picks its next page.
                        if (form.checkData) form.checkData(form.submission.data);
                        if (form.establishPages) form.establishPages();
                        next();
                    });
                };
                if (previous) return previous.call(self, currentPage, submission, function (err) { if (err) return next(err); advance(); });
                advance();
            };
            form.options.hooks = hooks;
            cleanups.push(function () { if (form.options.hooks === hooks) form.options.hooks = originalHooks; });
        }

        var agent = {
            extract: extract,
            state: state,
            detach: function () {
                clearTimeout(timer);
                if (inflight && inflight.abort) inflight.abort();
                clearAnnotations();
                cleanups.forEach(function (fn) { fn(); });
                cleanups = [];
                if (form.uagAgent === agent) form.uagAgent = null;
            }
        };
        form.uagAgent = agent;
        return agent;
    }

    /**
     * The formio.js fetch plugin: it records each form formio.js loads, and
     * sends the submission requests of forms tagged `uag` to the UAG, by id.
     * Nothing else is rerouted, and a request sent to the UAG is never retried
     * at Form.io: the form's server-side tasks must not be skipped.
     */
    function routingPlugin(uagUrl) {
        var forms = {};
        return {
            priority: 0,
            preRequest: function (args) {
                if (!args || !args.formio || (args.type !== 'submission' && args.type !== 'submissions')) return;
                var base = trimSlash(args.formio.formUrl);
                var definition = forms[base];
                if (!definition || !isUagForm(definition) || typeof args.url !== 'string' || args.url.indexOf(base) !== 0) return;
                var rest = args.url.slice(base.length);
                if (rest && rest.charAt(0) !== '/' && rest.charAt(0) !== '?') return;
                args.url = uagFormUrl(uagUrl, definition) + rest;
            },
            wrapRequestPromise: function (promise, args) {
                if (!args || args.type !== 'form' || !args.formio || !promise || typeof promise.then !== 'function') return promise;
                var base = trimSlash(args.formio.formUrl);
                return promise.then(function (definition) {
                    // A revision (`{form}/v/{n}`) is its own document: its `_id` is the
                    // revision's, and `_rid` the form's, which is where submissions go.
                    if (definition && definition._rid) {
                        if (!forms[base]) forms[base] = Object.assign({}, definition, { _id: definition._rid });
                    }
                    else if (definition && definition._id) {
                        forms[base] = definition;
                    }
                    return definition;
                });
            }
        };
    }

    /**
     * Attach Agent Input to a rendered `uag` form whose task has an input, once.
     * The form must say where it is on the UAG (its `_id`, as Form.io returns
     * it), whether it was loaded from its URL or rendered from a definition.
     */
    function autoAttach(form) {
        var options = registered.options || {};
        if (options.agentInput === false || form.uagAgent) return;
        if (!isUagForm(form.form) || !uagFormUrl(registered.uagUrl, form.form)) return;
        if (!findInputs(form, options.task).length) return;
        form.uagAgent = attach(form, {
            task: options.task,
            trigger: options.trigger || (form.form && form.form.display === 'wizard' ? 'next' : 'blur'),
            pauseMs: options.pauseMs,
            nextTimeoutMs: options.nextTimeoutMs,
            fetch: options.fetch,
            onStart: options.onStart,
            onResult: options.onResult,
            onError: options.onError,
            onDone: options.onDone
        });
    }

    /** Subclasses of a formio.js display that attach Agent Input once rendered. */
    function withAgentInput(Base) {
        return class extends Base {
            attach(element) {
                var self = this;
                return Promise.resolve(super.attach(element)).then(function (result) {
                    autoAttach(self);
                    return result;
                });
            }
            destroy(all) {
                if (this.uagAgent) {
                    this.uagAgent.detach();
                    this.uagAgent = null;
                }
                return super.destroy(all);
            }
        };
    }

    /**
     * The formio.js module: `Formio.use(UAG('https://uag.example.com', options))`.
     * Options: `agentInput` (`false` turns Agent Input off), and Agent Input's
     * `task`, `trigger`, `pauseMs`, `nextTimeoutMs` and callbacks.
     */
    function UAG(uagUrl, options) {
        if (!uagUrl) throw new Error('UAG(): give the UAG\'s URL, e.g. UAG(\'https://uag.example.com\').');
        return function (Formio) {
            registered = { uagUrl: trimSlash(uagUrl), Formio: Formio || null, options: options || {} };
            var mod = { fetch: { uag: routingPlugin(registered.uagUrl) } };
            var displays = (Formio && Formio.Displays && Formio.Displays.displays) || {};
            if ((options || {}).agentInput !== false) {
                mod.displays = {};
                ['webform', 'wizard'].forEach(function (name) {
                    if (displays[name]) mod.displays[name] = withAgentInput(displays[name]);
                });
            }
            return mod;
        };
    }
    UAG.attach = attach;

    return {
        UAG: UAG,
        attach: attach,
        uagFormUrl: uagFormUrl,
        routingPlugin: routingPlugin,
        ExtractionState: ExtractionState,
        SSEParser: SSEParser,
        isEmpty: isEmpty
    };
}));
