import { expect } from 'chai';
import { AnonymousLimiter, anonymousLimits } from '../../src/agent/anonymous';

describe('Anonymous agent limits', () => {
    const limits = { perAddress: 10, total: 100 };

    it('allows ten requests a minute from one address, then says when to retry', () => {
        const limiter = new AnonymousLimiter();
        const start = 1_000_000;
        for (let i = 0; i < 10; i++) expect(limiter.take('1.2.3.4', limits, start + i).allowed).to.equal(true);
        const refused: any = limiter.take('1.2.3.4', limits, start + 30000);
        expect(refused.allowed).to.equal(false);
        expect(refused.retryAfter).to.equal(30);
        expect(limiter.take('5.6.7.8', limits, start + 30000).allowed).to.equal(true);
        // The next minute starts afresh.
        expect(limiter.take('1.2.3.4', limits, start + 60000).allowed).to.equal(true);
    });

    it('caps all anonymous callers together', () => {
        const limiter = new AnonymousLimiter();
        for (let i = 0; i < 100; i++) expect(limiter.take(`10.0.0.${i}`, limits, 5).allowed, String(i)).to.equal(true);
        expect(limiter.take('10.0.1.1', limits, 6).allowed).to.equal(false);
    });

    it('reads the limits from the configuration, then the environment, defaulting to 10 and 100', () => {
        const saved = { a: process.env.AGENT_ANONYMOUS_RATE_LIMIT, t: process.env.AGENT_ANONYMOUS_TOTAL_RATE_LIMIT };
        try {
            delete process.env.AGENT_ANONYMOUS_RATE_LIMIT;
            delete process.env.AGENT_ANONYMOUS_TOTAL_RATE_LIMIT;
            const project = (agentApi: any = {}) => ({ formflowConfig: () => ({ agentApi }) }) as any;
            expect(anonymousLimits(project())).to.deep.equal({ perAddress: 10, total: 100 });
            process.env.AGENT_ANONYMOUS_RATE_LIMIT = '0';
            process.env.AGENT_ANONYMOUS_TOTAL_RATE_LIMIT = '50';
            expect(anonymousLimits(project())).to.deep.equal({ perAddress: 0, total: 50 });
            expect(anonymousLimits(project({ anonymous: { rateLimit: 3, totalRateLimit: 7 } }))).to.deep.equal({ perAddress: 3, total: 7 });
        }
        finally {
            for (const [name, value] of [['AGENT_ANONYMOUS_RATE_LIMIT', saved.a], ['AGENT_ANONYMOUS_TOTAL_RATE_LIMIT', saved.t]] as const) {
                if (value === undefined) delete process.env[name]; else process.env[name] = value;
            }
        }
    });
});
