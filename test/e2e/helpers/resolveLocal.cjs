/**
 * Preloaded into the UAG process by the license e2e suite (NODE_OPTIONS
 * --require). Resolves the host names in E2E_LOCAL_HOSTS (comma-separated) to
 * 127.0.0.1, so the UAG can reach the local Form.io container through a name
 * that is not on the local-endpoint allow list. Test-only; nothing outside the
 * e2e suite loads it.
 */
const dns = require('dns');
const hosts = new Set(String(process.env.E2E_LOCAL_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

const lookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    if (hosts.has(String(hostname).toLowerCase())) {
        const opts = typeof options === 'number' ? { family: options } : (options || {});
        if (opts.all) return process.nextTick(callback, null, [{ address: '127.0.0.1', family: 4 }]);
        return process.nextTick(callback, null, '127.0.0.1', 4);
    }
    return lookup.call(this, hostname, options, callback);
};

const promisesLookup = dns.promises.lookup;
dns.promises.lookup = async function (hostname, options) {
    if (hosts.has(String(hostname).toLowerCase())) {
        return options && options.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 };
    }
    return promisesLookup.call(this, hostname, options);
};
