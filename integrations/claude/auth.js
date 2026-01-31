let authToken = '';
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(payload);
    } catch (error) {
        console.error('Failed to decode JWT:', error);
        return null;
    }
}

/**
 * Performs a simple server-to-server authentication using the x-token header. This request is how you can
 * convert a project API key into a valid "admin" auth token used for MCP requests. It will also cache the 
 * auth token until it is close to expiring, and ensure that the x-token header is valid before any auth can
 * occur.
 * 
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 * @returns 
 */
export async function authenticate(req, res, next) {
    // They must ALWAYS provide an x-token header.
    if (!req.headers['x-token']) {
        res.status(401).json({ error: 'Unauthorized: Missing X-Token header' });
        return;
    }
    // The x-token header must match our project key.
    if (req.headers['x-token'] && req.headers['x-token'] !== process.env.UAG_PROJECT_KEY) {
        res.status(401).json({ error: 'Unauthorized: Invalid X-Token header' });
        return;
    }

    // If we have a cached auth token, ensure it is still valid and not close to expiring.
    if (authToken) {
        const decoded = decodeJWT(authToken);
        if (!decoded || !decoded.exp || (Date.now() / 1000) >= (decoded.exp - 60)) {
            authToken = '';
        }
    }

    // Check if we have a cached auth token.
    if (authToken) {
        req.authToken = authToken;
        return next();
    }

    // Fetch a new auth token from the UAG server.
    const resp = await fetch(`${process.env.UAG_SERVER}/${process.env.UAG_PROJECT_NAME}/auth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: 'x-token',
            client_secret: process.env.UAG_PROJECT_KEY,
        })
    });
    const data = await resp.json();
    authToken = req.authToken = data.access_token;
    next();
}