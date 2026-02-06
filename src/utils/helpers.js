import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Shared Utility Functions
 *
 * General-purpose helper functions used across multiple modules.
 */

/**
 * Get the package version from package.json
 * @param {string} [defaultVersion='1.0.0'] - Default version if package.json cannot be read
 * @returns {string} The package version
 */
export function getPackageVersion(defaultVersion = '1.0.0') {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const packageJsonPath = path.join(__dirname, '../../package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version || defaultVersion;
    } catch {
        return defaultVersion;
    }
}

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration (e.g., "1h23m45s")
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h${minutes}m${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m${secs}s`;
    }
    return `${secs}s`;
}


/**
 * Sleep for specified milliseconds
 * @param {number} ms - Duration to sleep in milliseconds
 * @returns {Promise<void>} Resolves after the specified duration
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a network error (transient)
 * @param {Error} error - The error to check
 * @returns {boolean} True if it is a network error
 */
export function isNetworkError(error) {
    const msg = error.message.toLowerCase();
    return (
        msg.includes('fetch failed') ||
        msg.includes('network error') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('socket hang up') ||
        msg.includes('timeout')
    );
}

/**
 * Generate random jitter for backoff timing (Thundering Herd Prevention)
 * Prevents all clients from retrying at the exact same moment after errors.
 * @param {number} maxJitterMs - Maximum jitter range (result will be ±maxJitterMs/2)
 * @returns {number} Random jitter value between -maxJitterMs/2 and +maxJitterMs/2
 */
export function generateJitter(maxJitterMs) {
    return Math.random() * maxJitterMs - (maxJitterMs / 2);
}

/**
 * Enhanced fetch that supports HTTP/HTTPS proxies via environment variables.
 * Uses https module fallback for Node.js native fetch which doesn't support agents.
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function fetchWithProxy(url, options = {}) {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    const isLocal = url.includes('127.0.0.1') || url.includes('localhost');

    // Default to native fetch for local requests or if no proxy is configured
    if (!proxy || isLocal) {
        try {
            return await fetch(url, options);
        } catch (error) {
            if (process.env.DEBUG) {
                console.error(`[Fetch Error] ${url}:`, error.message);
            }
            throw error;
        }
    }

    // Proxy is configured - use https shim for better reliability in Node.js
    try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        const agent = new HttpsProxyAgent(proxy);

        // For token refreshes and simple API calls, use https module which respects the agent
        // We'll use a simple wrapper to provide a fetch-like response object
        const { request } = await import('https');
        const { URL } = await import('url');

        const parsedUrl = new URL(url);
        const reqOptions = {
            method: options.method || 'GET',
            headers: options.headers || {},
            agent: agent,
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            port: parsedUrl.port || 443
        };

        return new Promise((resolve, reject) => {
            const req = request(reqOptions, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        text: () => Promise.resolve(body),
                        json: () => Promise.resolve(JSON.parse(body)),
                        headers: {
                            get: (name) => res.headers[name.toLowerCase()]
                        }
                    });
                });
            });

            req.on('error', reject);
            if (options.body) {
                const bodyStr = typeof options.body === 'string'
                    ? options.body
                    : options.body.toString();
                req.write(bodyStr);
            }
            req.end();
        });
    } catch (error) {
        if (process.env.DEBUG) {
            console.warn(`[Fetch Proxy Error] Fallback to native fetch for ${url}:`, error.message);
        }
        return fetch(url, options);
    }
}
