/**
 * @formio/uag-renderer — Agent Input for Form.io forms and wizards.
 *
 *   const form = await Formio.createForm(el, formJson);
 *   UAGAgent.attach(form, {
 *     baseUrl: 'https://uag.example.com',   // the UAG, not the Form.io server
 *     formName: 'claim',
 *     getToken: () => userBearerToken,      // a UAG token for the signed-in user
 *     trigger: 'next',                      // 'blur' | 'pause' | 'next' | 'button'
 *   });
 *
 * Components flagged `uag: "<task>"` and `uagField: "input"` are the input.
 * `task` names the task to extract for (the option was called `persona`, and
 * that name still works).
 * When the trigger fires, the plugin calls `POST /agent/extract`, applies each
 * engine's results as they stream in (so the form's conditionals react to fast
 * decisions first), and never overwrites a value the user entered or changed.
 * Works as a CommonJS module or as the browser global `UAGAgent`.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    }
    else {
        root.UAGAgent = factory();
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

    /** The task to extract for, from `task` or the legacy `persona` option. */
    var warnedPersona = false;
    function taskOption(options) {
        var task = options.task;
        var persona = options.persona;
        if (task && persona && task !== persona) {
            throw new Error('UAGAgent: the "task" and "persona" options name different tasks ("' + task + '" and "' + persona + '"). Use only "task".');
        }
        if (!task && persona && !warnedPersona && typeof console !== 'undefined') {
            warnedPersona = true;
            console.warn('UAGAgent: the "persona" option is deprecated; use "task".');
        }
        return task || persona;
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

    /**
     * Attach Agent Input to a rendered form. Returns a controller with
     * `extract()` (run now) and `detach()`.
     */
    function attach(form, options) {
        options = options || {};
        var fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
        var state = new ExtractionState();
        var trigger = options.trigger || 'blur';
        var pauseMs = options.pauseMs || 800;
        var nextTimeoutMs = options.nextTimeoutMs || 1500;
        var formName = options.formName || (form.form && (form.form.name || form.form.path));
        var task = taskOption(options);
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

        function showError(message) {
            if (!hasDom()) return;
            var anchor = findInputs(form, task)[0];
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
                    state.recordAgent(path, patch[path]);
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
         */
        function extract(followUp) {
            followUp = followUp === true;
            if (!fetchImpl) return Promise.reject(new Error('fetch is not available'));
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
            var done = Promise.resolve(options.getToken ? options.getToken() : null).then(function (token) {
                if (token) headers.Authorization = 'Bearer ' + token;
                return fetchImpl(options.baseUrl.replace(/\/$/, '') + '/agent/extract', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ form: formName, task: task, data: (form.submission && form.submission.data) || {} }),
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
                showError(err && err.message ? err.message : 'Filling in from your description failed. You can continue by hand.');
                if (options.onError) options.onError(err);
            }).then(function () {
                resolveDecided();
                if (inflight === controller) inflight = null;
                if (aborted) return;
                if (options.onDone) options.onDone(summary, { followUp: followUp });
                var revealed = !followUp && decidedValues > 0 && summary && (summary.excluded || []).some(function (entry) {
                    return /hidden/.test(entry.reason);
                });
                if (revealed) return extract(true).done;
            });
            return { decided: decided, done: done };
        }

        // Triggers.
        var inputs = findInputs(form, task);
        // formio.js emits `blur` and `change` on the form with the component
        // instance, so the triggers listen there for the task's inputs.
        var inputPaths = inputs.map(pathOf);
        var isInputPath = function (path) {
            return inputPaths.some(function (input) { return path === input || path.indexOf(input + '.') === 0; });
        };
        if (trigger === 'blur') {
            var onBlur = function (instance) {
                if (instance && isInputPath(pathOf(instance))) extract();
            };
            form.on('blur', onBlur);
            cleanups.push(function () { if (form.off) form.off('blur', onBlur); });
        }
        else if (trigger === 'pause') {
            var onTyping = function (event, flags, modified) {
                var instance = event && event.changed && (event.changed.instance || event.changed.component);
                if (!modified || !instance || !isInputPath(pathOf(instance))) return;
                clearTimeout(timer);
                timer = setTimeout(extract, pauseMs);
            };
            form.on('change', onTyping);
            cleanups.push(function () { if (form.off) form.off('change', onTyping); });
        }
        else if (trigger === 'next') {
            // Wait for decision results (bounded) before the wizard moves on, so
            // conditional pages reflect the triage.
            form.options = form.options || {};
            form.options.hooks = form.options.hooks || {};
            var previous = form.options.hooks.beforeNext;
            var inputPage = inputs.length && inputs[0].page;
            // formio.js calls beforeNext(currentPage, submission, next).
            form.options.hooks.beforeNext = function (currentPage, submission, next) {
                var run = function () {
                    if (inputPage !== undefined && form.page !== undefined && form.page !== inputPage) return next();
                    var pending = extract();
                    var timeout = new Promise(function (resolve) { setTimeout(resolve, nextTimeoutMs); });
                    Promise.race([pending.decided, timeout]).then(function () {
                        // formio.js debounces change handling, so conditional pages would
                        // not reflect the results yet when the wizard picks its next page.
                        if (form.checkData) form.checkData(form.submission.data);
                        if (form.establishPages) form.establishPages();
                        next();
                    });
                };
                if (previous) return previous(currentPage, submission, function (err) { if (err) return next(err); run(); });
                run();
            };
            cleanups.push(function () { form.options.hooks.beforeNext = previous; });
        }

        return {
            extract: extract,
            state: state,
            detach: function () {
                clearTimeout(timer);
                if (inflight && inflight.abort) inflight.abort();
                clearAnnotations();
                cleanups.forEach(function (fn) { fn(); });
            }
        };
    }

    return { attach: attach, ExtractionState: ExtractionState, SSEParser: SSEParser, isEmpty: isEmpty };
}));
