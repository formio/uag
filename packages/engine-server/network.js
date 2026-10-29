'use strict';
const os = require('os');
const net = require('net');

/**
 * Whether an address is private: loopback, link-local, RFC 1918, carrier-grade
 * NAT, or an IPv6 unique-local address.
 */
function isPrivateAddress(address) {
    const ip = String(address).replace(/^::ffff:/, '').split('%')[0];
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
            || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
    }
    return false;
}

/**
 * The public addresses a server bound to `host` is reachable on: `host` itself
 * when it is public, or every public interface address for a wildcard bind.
 */
function publicAddresses(host, interfaces = os.networkInterfaces()) {
    const wildcard = !host || host === '0.0.0.0' || host === '::';
    if (!wildcard) {
        return net.isIP(host) && !isPrivateAddress(host) ? [host] : [];
    }
    return Object.values(interfaces).flat()
        .filter((entry) => entry && !entry.internal && !isPrivateAddress(entry.address))
        .map((entry) => entry.address);
}

module.exports = { isPrivateAddress, publicAddresses };
