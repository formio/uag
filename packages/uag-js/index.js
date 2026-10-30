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
        // With `requireReview`, an uncertain value must be checked before the
        // wizard moves on or the form submits: the user changes it, or ticks
        // "Yes, this looks right" on its note.
        var requireReview = options.requireReview === true;
        var reviewed = {};
        var flagged = {};

        // Remember fields the user changes, so extraction never overwrites them.
        var onChange = function (event, flags, modified) {
            if (applying || !modified || !event || !event.changed) return;
            var instance = event.changed.instance || event.changed.component;
            var path = instance && (instance.path || instance.key);
            if (!path) return;
            state.recordUser(path);
            showReview(path);
        };
        form.on('change', onChange);
        cleanups.push(function () { if (form.off) form.off('change', onChange); });

        function clearAnnotations() {
            annotations.forEach(function (node) { if (node.parentNode) node.parentNode.removeChild(node); });
            annotations = [];
            noted = {};
            Object.keys(flagged).forEach(unflag);
            reviewed = {};
        }

        /** Whether an uncertain value has been checked: `changed` by the user, `checked` as right, or `pending`. */
        function reviewStatus(path) {
            if (state.source(path) === 'user') return 'changed';
            return reviewed[path] ? 'checked' : 'pending';
        }

        /**
         * Show on a field's note whether its value has been checked, and clear
         * its error once it has. The error lives on the note, not in formio.js's
         * validity, which the wizard recomputes (and so clears) after Next.
         */
        function showReview(path) {
            var entry = noted[path];
            if (!requireReview || !entry || entry.result.status !== 'uncertain') return;
            var status = reviewStatus(path);
            if (status !== 'pending') unflag(path);
            if (!entry.node) return;
            var shown = status === 'pending' && flagged[path] ? 'needed' : status;
            entry.node.className = 'uag-chip uag-uncertain' + { pending: '', needed: ' uag-review-needed', checked: ' uag-reviewed', changed: ' uag-reviewed' }[shown];
            entry.text.textContent = {
                pending: 'Please check this. ',
                needed: 'Please check this before you continue. ',
                checked: 'Thanks for checking. ',
                changed: 'You changed this. '
            }[shown];
            // A value the user changed has nothing left to confirm.
            entry.extras.forEach(function (node) { node.hidden = status === 'changed'; });
        }

        /** Clear the error a field was given for an unchecked value, and the form's alert once none is left. */
        function unflag(path) {
            if (!flagged[path]) return;
            delete flagged[path];
            if (!Object.keys(flagged).length && form.alert && form.setAlert) form.setAlert(false);
        }

        /** The wizard page a component is on (-1: a page the wizard is not showing); undefined when the form is not a wizard. */
        function pageOf(component) {
            if (!Array.isArray(form.pages)) return undefined;
            for (var node = component; node; node = node.parent) {
                var index = form.pages.indexOf(node);
                if (index !== -1) return index;
            }
            return -1;
        }

        /** Shown fields whose uncertain value is still to be checked; only those on `page`, when given. */
        function unreviewed(page) {
            return Object.keys(noted).filter(function (path) {
                if (noted[path].result.status !== 'uncertain' || reviewStatus(path) !== 'pending') return false;
                var component = form.getComponent(path);
                if (!component || component.visible === false) return false;
                var index = pageOf(component);
                return index !== -1 && (page === undefined || index === undefined || index === page);
            });
        }

        /**
         * Stop the wizard or the submission: mark each unchecked field's note,
         * give formio.js a message for its alert, and focus the first checkbox.
         */
        function block(paths, next) {
            next(paths.map(function (path) {
                flagged[path] = true;
                showReview(path);
                var label = form.getComponent(path).component.label;
                return { level: 'error', message: (label ? label + ': ' : '') + 'tick "Yes, this looks right", or change the answer.' };
            }));
            var first = noted[paths[0]];
            if (first.box && first.box.focus) first.box.focus();
        }

        function annotate(component, result) {
            if (!component) return;
            // Remembered, so a field on a page drawn later is annotated then.
            var path = result.path || pathOf(component);
            var entry = noted[path] = { result: result, node: null, text: null, box: null, extras: [] };
            if (!component.element || !hasDom()) return;
            var note;
            if (result.status === 'confident') {
                note = el('span', 'uag-chip uag-confident', 'Filled from your description' + (result.confidence !== undefined ? ' (' + pct(result.confidence) + ' sure)' : ''));
            }
            else if (result.status === 'uncertain') {
                // An uncertain value can still have a high choice confidence (for
                // example when the input may not address the question at all), so
                // no percentage here; unlikely alternatives are left out.
                if (requireReview) {
                    note = el('div', 'uag-chip uag-uncertain');
                    entry.text = el('span', 'uag-review-text', 'Please check this. ');
                    note.appendChild(entry.text);
                }
                else {
                    note = el('div', 'uag-chip uag-uncertain', 'Please check this. ');
                }
                (result.alternatives || []).filter(function (alt) { return !(alt.confidence < 0.05); }).forEach(function (alt) {
                    var button = el('button', 'uag-alternative', alt.label + ' ' + pct(alt.confidence));
                    button.type = 'button';
                    button.addEventListener('click', function () {
                        component.setValue(alt.value);
                        state.recordUser(path);
                        showReview(path);
                    });
                    note.appendChild(button);
                    entry.extras.push(button);
                });
                if (requireReview) {
                    var label = el('label', 'uag-review');
                    entry.box = el('input');
                    entry.box.type = 'checkbox';
                    entry.box.checked = !!reviewed[path];
                    entry.box.addEventListener('change', function () {
                        reviewed[path] = entry.box.checked;
                        showReview(path);
                    });
                    label.appendChild(entry.box);
                    label.appendChild(el('span', null, 'Yes, this looks right'));
                    note.appendChild(label);
                    entry.extras.push(label);
                }
            }
            else if (result.status === 'suggested') {
                note = el('span', 'uag-chip uag-suggested', 'Suggested from your description. Please check it.');
            }
            if (note) {
                component.element.appendChild(note);
                annotations.push(note);
                entry.node = note;
                showReview(path);
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

        if (requireReview) {
            // Installed before the triggers, so the `next` trigger's hook runs this
            // one first and extracts only once the page's values are checked.
            form.options = form.options || {};
            var reviewOriginalHooks = form.options.hooks;
            var reviewHooks = Object.assign({}, reviewOriginalHooks);
            var nextBefore = reviewHooks.beforeNext;
            var submitBefore = reviewHooks.beforeSubmit;
            // formio.js calls beforeNext(currentPage, submission, next) on the form.
            reviewHooks.beforeNext = function (currentPage, submission, next) {
                var check = function () {
                    var paths = unreviewed(form.page);
                    if (paths.length) return block(paths, next);
                    next();
                };
                if (nextBefore) return nextBefore.call(this, currentPage, submission, function (err) { if (err) return next(err); check(); });
                check();
            };
            // And beforeSubmit(submission, next), where next takes (err, submission).
            reviewHooks.beforeSubmit = function (submission, next) {
                var check = function (data) {
                    var paths = unreviewed();
                    if (!paths.length) return next(null, data);
                    // Show the first unchecked field, which may be on an earlier page.
                    var page = pageOf(form.getComponent(paths[0]));
                    if (page === undefined || page === form.page || !form.setPage) return block(paths, next);
                    Promise.resolve(form.setPage(page)).then(function () { block(paths, next); });
                };
                if (submitBefore) return submitBefore.call(this, submission, function (err, data) { if (err) return next(err); check(data); });
                check(submission);
            };
            form.options.hooks = reviewHooks;
            cleanups.push(function () { if (form.options.hooks === reviewHooks) form.options.hooks = reviewOriginalHooks; });
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
                // Last installed, first removed, so each hook wrapper restores the one it wrapped.
                cleanups.reverse().forEach(function (fn) { fn(); });
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
            requireReview: options.requireReview,
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

    /*
     * The chat: a formio.js display that renders a form as a conversation.
     *
     *   Formio.use(UAG('https://uag.example.com'));
     *   Formio.createChat(element, 'https://forms.example.com/myproject/servicerequest');
     *
     * Each message the person sends goes to the form's chat on the UAG
     * (`{form}/agent/chat`) with the conversation and the form's data; the
     * values in the reply are written into the form's own components, so its
     * conditionals and validation apply. Nothing is submitted until the person
     * confirms, and then the form submits itself, through the UAG, as any `uag`
     * form does. The real form is one click away, to review or edit.
     */

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Text as HTML: escaped, with its line breaks kept. */
    function textHtml(text) {
        return escapeHtml(text).replace(/\r?\n/g, '<br>');
    }

    /**
     * The built-in templates. Each escapes what it interpolates, and uses only
     * `uag-chat-*` classes, so it looks the same under any CSS framework. A
     * template of the same name in `options.templates` or the current framework
     * replaces it; what the chat needs from a template is its `ref` attributes.
     */
    var CHAT_TEMPLATES = {
        uagChat: {
            form: function (ctx) {
                var formView = ctx.view === 'form';
                return '<div class="uag-chat' + (formView ? ' uag-chat--form' : '') + '" ref="uagChat">' +
                    '<div class="uag-chat__header">' +
                        '<div class="uag-chat__title">' + escapeHtml(ctx.title) + '</div>' +
                        '<button type="button" class="uag-chat__action" ref="uagChatOpen"' + (formView ? ' hidden' : '') + '>' + escapeHtml(ctx.labels.open) + '</button>' +
                        '<button type="button" class="uag-chat__action" ref="uagChatReset">' + escapeHtml(ctx.labels.reset) + '</button>' +
                    '</div>' +
                    '<div class="uag-chat__log" ref="uagChatLog" role="log" aria-live="polite" aria-label="' + escapeHtml(ctx.labels.log) + '"' + (formView ? ' hidden' : '') + '>' + ctx.log + '</div>' +
                    '<div class="uag-chat__composer" ref="uagChatComposer"' + (formView ? ' hidden' : '') + '>' + ctx.composer + '</div>' +
                    '<div class="uag-chat__form" ref="uagChatForm"' + (formView ? '' : ' hidden') + '>' +
                        '<div class="uag-chat__form-bar"><button type="button" class="uag-chat__action" ref="uagChatClose">' + escapeHtml(ctx.labels.close) + '</button></div>' +
                        ctx.form +
                    '</div>' +
                '</div>';
            }
        },
        uagChatMessage: {
            form: function (ctx) {
                return '<div class="uag-chat__message uag-chat__message--' + escapeHtml(ctx.role) + '">' + ctx.html + '</div>';
            }
        },
        uagChatTyping: {
            form: function (ctx) {
                return '<div class="uag-chat__message uag-chat__message--assistant uag-chat__typing" role="status" aria-label="' + escapeHtml(ctx.ariaLabel) + '"><span></span><span></span><span></span></div>';
            }
        },
        uagChatSuggestions: {
            form: function (ctx) {
                return '<div class="uag-chat__suggestions">' + ctx.suggestions.map(function (text, index) {
                    return '<button type="button" class="uag-chat__suggestion" ref="uagChatSuggestion" data-index="' + index + '">' + escapeHtml(text) + '</button>';
                }).join('') + '</div>';
            }
        },
        uagChatComposer: {
            form: function (ctx) {
                return '<label class="uag-chat__sr-only" for="' + escapeHtml(ctx.inputId) + '">' + escapeHtml(ctx.inputLabel) + '</label>' +
                    '<input id="' + escapeHtml(ctx.inputId) + '" class="uag-chat__input" ref="uagChatInput" type="text" autocomplete="off" maxlength="' + escapeHtml(ctx.maxLength) + '" placeholder="' + escapeHtml(ctx.placeholder) + '"' + (ctx.inactive ? ' disabled' : '') + '>' +
                    '<button type="button" class="uag-chat__send" ref="uagChatSend"' + (ctx.inactive || ctx.busy ? ' disabled' : '') + '>' + escapeHtml(ctx.sendLabel) + '</button>';
            }
        },
        uagChatSummary: {
            form: function (ctx) {
                return '<div class="uag-chat__summary">' +
                    '<div class="uag-chat__summary-title">' + escapeHtml(ctx.title) + '</div>' +
                    '<dl>' + ctx.rows.map(function (row) {
                        return '<dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd>';
                    }).join('') + '</dl>' +
                    '<div class="uag-chat__summary-actions">' +
                        '<button type="button" class="uag-chat__submit" ref="uagChatSubmit"' + (ctx.busy ? ' disabled' : '') + '>' + escapeHtml(ctx.submitLabel) + '</button>' +
                        '<button type="button" class="uag-chat__action" ref="uagChatEdit">' + escapeHtml(ctx.editLabel) + '</button>' +
                    '</div>' +
                '</div>';
            }
        },
        uagChatNotice: {
            form: function (ctx) {
                return '<div class="uag-chat__notice uag-chat__notice--' + escapeHtml(ctx.kind) + '" role="' + (ctx.kind === 'error' ? 'alert' : 'status') + '">' + escapeHtml(ctx.text) + '</div>';
            }
        }
    };

    /** The formio.js the chat runs with: the one given to `UAG()`, else the page's global. */
    function formioSdk() {
        if (registered.Formio) return registered.Formio;
        if (typeof window !== 'undefined' && window.Formio) return window.Formio;
        return null;
    }

    /** Storage for `options.storage`, or null when unavailable (private windows, servers). */
    function chatStorage(kind) {
        try {
            if (kind === 'local' && typeof localStorage !== 'undefined') return localStorage;
            if (kind === 'session' && typeof sessionStorage !== 'undefined') return sessionStorage;
        }
        catch (err) {
            return null;
        }
        return null;
    }

    /** Who a Form.io token belongs to (its user's id), for keeping conversations apart; `anonymous` without one. */
    function chatUserOf(token) {
        try {
            var payload = token ? JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
            return (payload && payload.user && payload.user._id) || (token ? 'user' : 'anonymous');
        }
        catch (err) {
            return token ? 'user' : 'anonymous';
        }
    }

    /** The newest messages a turn may carry, starting at one the person wrote. */
    function recentMessages(messages, max) {
        var start = Math.max(0, messages.length - max);
        while (start < messages.length - 1 && messages[start].role !== 'user') start++;
        return messages.slice(start);
    }

    /** The `chat` display: a subclass of formio.js's webform display. */
    function chatDisplay(Base, sdk) {
        return class ChatForm extends Base {
            constructor(element, options) {
                super(element, options);
                this.chat = {
                    entries: [],
                    busy: false,
                    conversation: 0,
                    view: 'chat',
                    complete: false,
                    submitted: false,
                    response: null,
                    unsupportedKey: '',
                    restored: false,
                    state: new ExtractionState(),
                    applying: false
                };
                var self = this;
                // Remember the fields the person changes by hand, so a reply never overwrites them.
                this.on('change', function (event, flags, modified) {
                    if (self.chat.applying || !modified || !event || !event.changed) return;
                    var instance = event.changed.instance || event.changed.component;
                    var path = instance && (instance.path || instance.key);
                    if (path) self.chat.state.recordUser(path);
                });
            }

            /** The messages of the conversation, in order (not the notices or the greeting). */
            get messages() {
                return this.chat.entries.filter(function (entry) { return entry.kind === 'message' && !entry.local; })
                    .map(function (entry) { return { role: entry.role, content: entry.text }; });
            }

            get chatOptions() {
                return this.options || {};
            }

            /** Whether the form can be used for chat: it is tagged `uag` and the UAG knows it. */
            get chatAvailable() {
                return isUagForm(this.form) && !!this.chatUrl;
            }

            /** Where turns are sent: `chatUrl`, or the form's chat on the UAG. */
            get chatUrl() {
                if (this.chatOptions.chatUrl) return this.chatOptions.chatUrl;
                var formUrl = uagFormUrl(this.chatOptions.uagUrl || registered.uagUrl, this.form);
                return formUrl ? formUrl + '/agent/chat' : '';
            }

            /** Per form and per signed-in user, so one person never continues another's conversation. */
            get chatStorageKey() {
                return 'uag-chat:' + (this.chatUrl || (this.form && (this.form._id || this.form.name)) || 'form') + ':' + chatUserOf(this.chatToken());
            }

            /**
             * Built-in chat templates come after `options.templates` and the
             * current framework's, and before formio.js's own defaults.
             */
            getTemplate(names, modes) {
                var list = Array.isArray(names) ? names : [names];
                var name = list[list.length - 1];
                if (!CHAT_TEMPLATES[name]) return super.getTemplate(names, modes);
                var modeList = Array.isArray(modes) ? modes.slice() : [modes];
                if (modeList.indexOf('form') === -1) modeList.push('form');
                var found = this.options.templates && this.checkTemplate(this.options.templates, list, modeList);
                var Templates = sdk && sdk.Templates;
                var framework = Templates && (this.options.template ? Templates.templates[this.options.template] : Templates.current);
                found = found || (framework && this.checkTemplate(framework, list, modeList));
                return found || { template: CHAT_TEMPLATES[name].form };
            }

            chatLabels() {
                return {
                    open: this.t('Review form'),
                    close: this.t('Back to chat'),
                    reset: this.t('Start over'),
                    log: this.t('Conversation')
                };
            }

            renderChatMessage(entry) {
                if (entry.kind === 'notice') {
                    return this.renderTemplate('uagChatNotice', { kind: entry.level, text: entry.text });
                }
                var html = textHtml(entry.text);
                if (entry.role === 'assistant' && typeof this.chatOptions.markdown === 'function') {
                    try {
                        html = this.sanitize(String(this.chatOptions.markdown(entry.text) || ''), true);
                    }
                    catch (err) {
                        html = textHtml(entry.text);
                    }
                }
                return this.renderTemplate('uagChatMessage', { role: entry.role, text: entry.text, html: html });
            }

            /** The summary's rows: each visible field with a value, as the form shows it. */
            summaryRows() {
                var rows = [];
                this.everyComponent(function (component) {
                    var schema = component.component || {};
                    if (!schema.input || schema.type === 'button' || schema.type === 'hidden' || !component.visible) return;
                    if (component.hasChildren || (component.components && component.components.length && schema.type !== 'datagrid' && schema.type !== 'editgrid')) return;
                    var value = component.dataValue;
                    if (isEmpty(value)) return;
                    var view;
                    try {
                        view = component.getView ? component.getView(value) : value;
                    }
                    catch (err) {
                        view = value;
                    }
                    if (view && typeof view === 'object') view = JSON.stringify(view);
                    // getView may return markup for some components; the summary shows text.
                    view = String(view === undefined || view === null ? '' : view).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    rows.push({ label: schema.label || schema.key, value: view });
                });
                return rows;
            }

            /** The first entry: the greeting, or why the form cannot be used for chat. Not part of the conversation. */
            renderIntro() {
                if (!this.form || !Array.isArray(this.form.components) || !this.form.components.length) return '';
                if (!this.chatAvailable) {
                    return this.renderChatMessage({ kind: 'notice', level: 'error', text: this.t('This form is not available for chat.') });
                }
                var greeting = this.chatOptions.greeting !== undefined
                    ? this.chatOptions.greeting
                    : 'Hi! I can help you fill in {{title}}. What would you like to tell me?';
                return greeting ? this.renderChatMessage({ kind: 'message', role: 'assistant', text: this.t(greeting, { title: this.form.title || '' }) }) : '';
            }

            renderLog() {
                var self = this;
                var html = this.renderIntro() + this.chat.entries.map(function (entry) { return self.renderChatMessage(entry); }).join('');
                var suggestions = (this.chatOptions.suggestions || []).filter(function (text) { return typeof text === 'string' && text; });
                if (suggestions.length && !this.messages.length && this.chatAvailable) {
                    html += this.renderTemplate('uagChatSuggestions', { suggestions: suggestions.map(function (text) { return self.t(text); }) });
                }
                if (this.chat.busy) {
                    html += this.renderTemplate('uagChatTyping', { ariaLabel: this.t('The assistant is typing') });
                }
                if (this.chat.complete && !this.chat.submitted && !this.chat.busy) {
                    html += this.renderTemplate('uagChatSummary', {
                        title: this.t('Please check your answers'),
                        rows: this.summaryRows(),
                        submitLabel: this.t(this.chatOptions.submitLabel || 'Submit'),
                        editLabel: this.t('Edit in the form'),
                        busy: this.chat.busy
                    });
                }
                return html;
            }

            renderComposer() {
                return this.renderTemplate('uagChatComposer', {
                    inputId: this.id + '-uag-chat-input',
                    inputLabel: this.t('Message'),
                    placeholder: this.t(this.chatOptions.placeholder || 'Type your message…'),
                    sendLabel: this.t('Send'),
                    maxLength: this.chatOptions.maxMessageLength || 2000,
                    // Not `disabled`: formio.js sets that on every template's context.
                    inactive: !this.chatAvailable || this.chat.submitted,
                    busy: this.chat.busy
                });
            }

            render() {
                return this.renderTemplate('uagChat', {
                    title: this.t(this.chatOptions.title || (this.form && this.form.title) || ''),
                    view: this.chat.view,
                    labels: this.chatLabels(),
                    log: this.renderLog(),
                    composer: this.renderComposer(),
                    form: super.render()
                });
            }

            attach(element) {
                var self = this;
                var attached = super.attach(element);
                this.loadRefs(element, {
                    uagChat: 'single',
                    uagChatLog: 'single',
                    uagChatComposer: 'single',
                    uagChatInput: 'single',
                    uagChatSend: 'single',
                    uagChatForm: 'single',
                    uagChatOpen: 'single',
                    uagChatClose: 'single',
                    uagChatReset: 'single'
                });
                this.attachChatControls();
                return Promise.resolve(attached).then(function (result) {
                    self.restoreChat();
                    self.scrollChat();
                    return result;
                });
            }

            attachChatControls() {
                var self = this;
                var refs = this.refs;
                if (refs.uagChatSend) {
                    this.addEventListener(refs.uagChatSend, 'click', function () { self.sendFromInput(); });
                }
                if (refs.uagChatInput) {
                    this.addEventListener(refs.uagChatInput, 'keydown', function (event) {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            self.sendFromInput();
                        }
                    });
                }
                if (refs.uagChatOpen) this.addEventListener(refs.uagChatOpen, 'click', function () { self.openForm(); });
                if (refs.uagChatClose) this.addEventListener(refs.uagChatClose, 'click', function () { self.closeForm(); });
                if (refs.uagChatReset) this.addEventListener(refs.uagChatReset, 'click', function () { self.reset(); });
                // The log is redrawn often: its buttons are handled where they land.
                if (refs.uagChatLog) {
                    this.addEventListener(refs.uagChatLog, 'click', function (event) {
                        var target = event.target && event.target.closest ? event.target.closest('[ref]') : null;
                        if (!target || !refs.uagChatLog.contains(target)) return;
                        var ref = target.getAttribute('ref');
                        if (ref === 'uagChatSuggestion') self.send(target.textContent || '');
                        else if (ref === 'uagChatSubmit') self.submitChat();
                        else if (ref === 'uagChatEdit') self.openForm();
                    });
                }
            }

            sendFromInput() {
                var input = this.refs.uagChatInput;
                if (!input || this.chat.busy) return;
                var text = input.value;
                if (!String(text || '').trim()) return;
                input.value = '';
                this.send(text);
            }

            scrollChat() {
                var log = this.refs && this.refs.uagChatLog;
                if (log) log.scrollTop = log.scrollHeight;
            }

            /** Redraw the log and the composer from the chat's state. */
            updateChat() {
                if (!this.refs || !this.refs.uagChatLog) return;
                this.refs.uagChatLog.innerHTML = this.sanitize(this.renderLog(), true);
                if (this.refs.uagChatComposer) {
                    var focused = typeof document !== 'undefined' && document.activeElement === this.refs.uagChatInput;
                    var typed = this.refs.uagChatInput ? this.refs.uagChatInput.value : '';
                    this.refs.uagChatComposer.innerHTML = this.sanitize(this.renderComposer(), true);
                    this.loadRefs(this.refs.uagChatComposer, { uagChatInput: 'single', uagChatSend: 'single' });
                    var self = this;
                    if (this.refs.uagChatSend) this.addEventListener(this.refs.uagChatSend, 'click', function () { self.sendFromInput(); });
                    if (this.refs.uagChatInput) {
                        this.refs.uagChatInput.value = typed;
                        this.addEventListener(this.refs.uagChatInput, 'keydown', function (event) {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                self.sendFromInput();
                            }
                        });
                        if (focused && !this.refs.uagChatInput.disabled) this.refs.uagChatInput.focus();
                    }
                }
                this.scrollChat();
            }

            addChatEntry(entry) {
                this.chat.entries.push(entry);
                if (entry.kind === 'message') this.emit('chatMessage', { role: entry.role, content: entry.text });
            }

            notice(level, text) {
                this.addChatEntry({ kind: 'notice', level: level, text: text });
                this.updateChat();
            }

            setView(view) {
                this.chat.view = view;
                var refs = this.refs || {};
                var formView = view === 'form';
                if (refs.uagChat) refs.uagChat.classList.toggle('uag-chat--form', formView);
                [refs.uagChatLog, refs.uagChatComposer, refs.uagChatOpen].forEach(function (node) { if (node) node.hidden = formView; });
                if (refs.uagChatForm) refs.uagChatForm.hidden = !formView;
                if (!formView) this.updateChat();
            }

            openForm() {
                this.setView('form');
            }

            closeForm() {
                this.setView('chat');
            }

            /** The person's Form.io token, as formio.js holds it. */
            chatToken() {
                return formioToken(this);
            }

            /**
             * Send a message: post the conversation and the form's data to the
             * form's chat, then show the reply and apply its values. Resolves
             * when the turn is over; failures are shown, never thrown.
             */
            send(text) {
                var self = this;
                text = String(text || '').trim();
                if (!text || this.chat.busy || this.chat.submitted || !this.chatAvailable) return Promise.resolve(null);
                var fetchImpl = this.chatOptions.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
                var conversation = this.chat.conversation;
                this.addChatEntry({ kind: 'message', role: 'user', text: text });
                this.chat.busy = true;
                this.updateChat();
                var headers = { 'Content-Type': 'application/json' };
                var token = this.chatToken();
                if (token) headers['x-jwt-token'] = token;
                var body = {
                    messages: recentMessages(this.messages, this.chatOptions.maxMessages || 40),
                    // What the person set in the form itself: the chat never changes it.
                    locked: Object.keys(this.chat.state.userEdited),
                    data: (this.submission && this.submission.data) || {}
                };
                return Promise.resolve().then(function () {
                    if (!fetchImpl) throw new Error(self.t('The chat is unavailable: fetch is not available.'));
                    return fetchImpl(self.chatUrl, { method: 'POST', headers: headers, body: JSON.stringify(body) });
                }).then(function (response) {
                    return response.text().then(function (raw) {
                        var payload = null;
                        try {
                            payload = raw ? JSON.parse(raw) : null;
                        }
                        catch (err) {
                            payload = null;
                        }
                        if (!response.ok) {
                            var failure = new Error((payload && (payload.error || payload.detail)) || self.t('The assistant could not answer ({{status}}). Please try again.', { status: response.status }));
                            failure.status = response.status;
                            failure.response = payload;
                            throw failure;
                        }
                        return payload;
                    });
                }).then(function (payload) {
                    if (conversation !== self.chat.conversation) return null;
                    self.chat.busy = false;
                    self.applyTurn(payload || {});
                    return payload;
                }).catch(function (err) {
                    if (conversation !== self.chat.conversation) return null;
                    self.chat.busy = false;
                    self.notice('error', (err && err.message) || self.t('The assistant could not answer. Please try again.'));
                    self.emit('chatError', err);
                    return null;
                });
            }

            /** Show a turn's reply, apply its values, and move on when the form is ready. */
            applyTurn(response) {
                var self = this;
                var wasComplete = this.chat.complete;
                this.chat.response = response;
                if (response.reply) this.addChatEntry({ kind: 'message', role: 'assistant', text: String(response.reply) });
                this.applyPatch(response.patch || {});
                this.chat.complete = !!response.complete;
                this.emit('chatReply', response);
                var unsupported = ((response.remaining && response.remaining.unsupported) || []).filter(function (field) { return field.required && field.empty; });
                // Said once for each set of fields, not on every reply while they stay empty.
                var unsupportedKey = unsupported.map(function (field) { return field.path; }).join(',');
                var newlyUnsupported = !!unsupported.length && unsupportedKey !== this.chat.unsupportedKey;
                this.chat.unsupportedKey = unsupportedKey;
                if (newlyUnsupported) {
                    this.addChatEntry({
                        kind: 'notice',
                        level: 'info',
                        text: this.t('Please finish these in the form: {{fields}}', { fields: unsupported.map(function (field) { return field.label; }).join(', ') })
                    });
                }
                this.saveChat();
                this.updateChat();
                if (newlyUnsupported) this.openForm();
                if (this.chat.complete && !wasComplete) this.emit('chatComplete', response);
                if (response.confirmed && this.chat.complete) return this.submitChat();
                return Promise.resolve(response);
            }

            /** Write a turn's values into the form, never over the person's own. */
            applyPatch(patch) {
                var self = this;
                this.chat.applying = true;
                try {
                    Object.keys(patch).forEach(function (path) {
                        var component = self.getComponent(path);
                        if (!component) return;
                        if (!self.chat.state.canApply(path, component.getValue())) return;
                        component.setValue(patch[path]);
                        var written = component.getValue();
                        self.chat.state.recordAgent(path, written === undefined ? patch[path] : written);
                    });
                }
                finally {
                    this.chat.applying = false;
                }
            }

            /** Submit the form through formio.js (so through the UAG), and say how it went. */
            submitChat() {
                var self = this;
                if (this.chat.submitted || this.chat.busy) return Promise.resolve(null);
                var conversation = this.chat.conversation;
                this.chat.busy = true;
                this.updateChat();
                return Promise.resolve().then(function () {
                    return self.submit();
                }).then(function (submission) {
                    // Started over while it was saving: the new conversation is not the one submitted.
                    if (conversation !== self.chat.conversation) return submission;
                    self.chat.busy = false;
                    self.chat.submitted = true;
                    self.addChatEntry({ kind: 'message', role: 'assistant', local: true, text: self.t(self.chatOptions.submitted || 'Thanks! Your form was submitted.') });
                    self.clearChatStorage();
                    self.updateChat();
                    return submission;
                }).catch(function (err) {
                    if (conversation !== self.chat.conversation) return null;
                    self.chat.busy = false;
                    var errors = Array.isArray(err) ? err : [err];
                    var text = errors.map(function (item) {
                        if (typeof item === 'string') return item;
                        return (item && (item.message || item.error || (item.details && item.details[0] && item.details[0].message))) || '';
                    }).filter(Boolean).join(' ') || self.t('The form could not be submitted.');
                    self.notice('error', text);
                    self.emit('chatError', err);
                    return null;
                });
            }

            /** Start the conversation again, clearing the values the chat wrote. */
            reset() {
                var self = this;
                var wasSubmitted = this.chat.submitted;
                this.chat.conversation++;
                this.chat.busy = false;
                this.chat.complete = false;
                this.chat.submitted = false;
                this.chat.response = null;
                this.chat.entries = [];
                this.chat.unsupportedKey = '';
                this.chat.applying = true;
                try {
                    if (wasSubmitted) {
                        // A new request starts from an empty form, not as an update of the one just saved.
                        this.resetValue();
                        this._submission = { data: this.data };
                    }
                    Object.keys(this.chat.state.agentValues).forEach(function (path) {
                        var component = self.getComponent(path);
                        if (component && self.chat.state.canApply(path, component.getValue())) {
                            component.setValue(component.emptyValue !== undefined ? component.emptyValue : '');
                        }
                    });
                }
                finally {
                    this.chat.applying = false;
                }
                this.chat.state = new ExtractionState();
                this.clearChatStorage();
                this.setView('chat');
                this.updateChat();
                this.emit('chatReset');
            }

            saveChat() {
                var storage = chatStorage(this.chatOptions.storage);
                if (!storage) return;
                try {
                    storage.setItem(this.chatStorageKey, JSON.stringify({
                        entries: this.chat.entries,
                        data: (this.submission && this.submission.data) || {},
                        agentValues: this.chat.state.agentValues,
                        userEdited: this.chat.state.userEdited,
                        complete: this.chat.complete
                    }));
                }
                catch (err) {
                    // A full or blocked storage only loses the continuation.
                }
            }

            clearChatStorage() {
                var storage = chatStorage(this.chatOptions.storage);
                try {
                    if (storage) storage.removeItem(this.chatStorageKey);
                }
                catch (err) {
                    // Nothing to clear.
                }
            }

            /** Continue a conversation kept with `options.storage`, once. */
            restoreChat() {
                if (this.chat.restored) return;
                this.chat.restored = true;
                // A submission loaded from its URL is what the form shows; a kept conversation does not replace it.
                if (this.submission && this.submission._id) return;
                var storage = chatStorage(this.chatOptions.storage);
                var saved = null;
                try {
                    saved = storage ? JSON.parse(storage.getItem(this.chatStorageKey) || 'null') : null;
                }
                catch (err) {
                    saved = null;
                }
                if (!saved || !Array.isArray(saved.entries)) return;
                this.chat.entries = saved.entries.filter(function (entry) { return entry && typeof entry.text === 'string'; });
                this.chat.state.agentValues = saved.agentValues || {};
                this.chat.state.userEdited = saved.userEdited || {};
                this.chat.complete = !!saved.complete;
                this.chat.applying = true;
                try {
                    this.setValue({ data: saved.data || {} });
                }
                finally {
                    this.chat.applying = false;
                }
                this.updateChat();
            }
        };
    }

    var chatClasses = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

    /** The `chat` display for this formio.js, built once on its original webform display. */
    function chatDisplayFor(sdk, Base) {
        var Webform = Base || (sdk && sdk.Displays && sdk.Displays.displays && sdk.Displays.displays.webform);
        if (!Webform) throw new Error('createChat(): formio.js 5 is required.');
        var cached = chatClasses && chatClasses.get(Webform);
        if (cached) return cached;
        var ChatForm = chatDisplay(Webform, sdk);
        if (chatClasses) chatClasses.set(Webform, ChatForm);
        return ChatForm;
    }

    /**
     * Render a form as a chat, as `Formio.createForm` renders it as a form.
     * `src` is the form's Form.io URL (or a definition with its `_id`); the
     * promise resolves to the chat, a formio.js form with chat methods.
     */
    function createChat(element, src, options) {
        var sdk = formioSdk();
        if (!sdk || !sdk.Form || !sdk.Displays) {
            return Promise.reject(new Error('createChat(): load formio.js 5 and register the UAG first: Formio.use(UAG(\'https://uag.example.com\')).'));
        }
        if (!sdk.Displays.displays.chat) sdk.Displays.addDisplay('chat', chatDisplayFor(sdk));
        var wrapper = new sdk.Form(element, undefined, Object.assign({}, options || {}));
        wrapper.instance = wrapper.create('chat');
        return wrapper.setForm(src);
    }

    /**
     * The formio.js module: `Formio.use(UAG('https://uag.example.com', options))`.
     * Options: `agentInput` (`false` turns Agent Input off), and Agent Input's
     * `task`, `trigger`, `pauseMs`, `nextTimeoutMs` and callbacks. It also
     * registers the `chat` display, and `Formio.createChat`.
     */
    function UAG(uagUrl, options) {
        if (!uagUrl) throw new Error('UAG(): give the UAG\'s URL, e.g. UAG(\'https://uag.example.com\').');
        return function (Formio) {
            registered = { uagUrl: trimSlash(uagUrl), Formio: Formio || null, options: options || {} };
            var mod = { fetch: { uag: routingPlugin(registered.uagUrl) } };
            var displays = (Formio && Formio.Displays && Formio.Displays.displays) || {};
            mod.displays = {};
            // The chat builds on the original webform display, never on Agent Input's.
            if (displays.webform) mod.displays.chat = chatDisplayFor(Formio, displays.webform);
            if ((options || {}).agentInput !== false) {
                ['webform', 'wizard'].forEach(function (name) {
                    if (displays[name]) mod.displays[name] = withAgentInput(displays[name]);
                });
            }
            if (Formio && typeof Formio.createChat !== 'function') {
                Formio.createChat = createChat;
            }
            return mod;
        };
    }
    UAG.attach = attach;
    UAG.createChat = createChat;

    return {
        UAG: UAG,
        attach: attach,
        createChat: createChat,
        uagFormUrl: uagFormUrl,
        routingPlugin: routingPlugin,
        ExtractionState: ExtractionState,
        SSEParser: SSEParser,
        isEmpty: isEmpty,
        CHAT_TEMPLATES: CHAT_TEMPLATES
    };
}));
