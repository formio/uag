/**
 * Visitors type real-looking personal details into the demos, so nothing they
 * submit is kept for long: every hour, submissions older than
 * DEMO_RETENTION_HOURS are deleted from the demo's forms.
 */
const BATCH = 100;

export function startRetention({ config, formio }) {
    if (!config.retentionHours) return () => {};
    async function purge() {
        const cutoff = new Date(Date.now() - config.retentionHours * 3_600_000).toISOString();
        for (const form of config.retentionForms) {
            try {
                const path = await formio.pathOf(form);
                for (let round = 0; round < 50; round++) {
                    const old = await formio.request(`/${path}/submission?created__lt=${encodeURIComponent(cutoff)}&limit=${BATCH}&select=_id`);
                    if (!old.ok || !Array.isArray(old.body) || !old.body.length) break;
                    for (const submission of old.body) {
                        await formio.request(`/${path}/submission/${submission._id}`, { method: 'DELETE' });
                    }
                    if (old.body.length < BATCH) break;
                }
            }
            catch (err) {
                console.error(`Could not purge old ${form} submissions:`, err.message);
            }
        }
    }
    const timer = setInterval(purge, 3_600_000);
    timer.unref();
    setTimeout(purge, 60_000).unref();
    return () => clearInterval(timer);
}
