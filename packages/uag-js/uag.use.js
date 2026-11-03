/**
 * @formio/uag-js for a page without a bundler. Load it after formio.js and
 * this package's index.js, from the UAG it should talk to:
 *
 *   <script src="https://cdn.form.io/js/formio.full.min.js"></script>
 *   <script src="https://uag.example.com/uag-js/uag.use.js"></script>
 *
 * The UAG serves this file at /uag-js/uag.use.js with the bundle and its
 * manifest included. On its own, it registers FormioUAG (index.js) with the
 * UAG it was loaded from, read from its own src, and fetches the manifest.
 */
(function () {
    var script = document.currentScript;
    var src = script && script.src ? new URL(script.src, location.href) : null;
    var uagUrl = src && src.href.indexOf('/uag-js/') !== -1 ? src.href.slice(0, src.href.indexOf('/uag-js/')) : (src ? src.origin : location.origin);
    function register() {
        if (!window.Formio || !window.FormioUAG || typeof window.Formio.use !== 'function') return false;
        window.Formio.use(window.FormioUAG.UAG(uagUrl));
        return true;
    }
    if (!register()) {
        var tries = 0;
        var timer = setInterval(function () { if (register() || ++tries > 600) clearInterval(timer); }, 50);
    }
})();
