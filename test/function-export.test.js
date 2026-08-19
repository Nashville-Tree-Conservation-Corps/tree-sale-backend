import { describe, it, expect } from 'vitest'

describe('functions entrypoint', () => {
    it('exports an api https function pinned to us-central1', async () => {
        process.env.JWT_SECRET = 'test-secret'
        process.env.GOOGLE_CLIENT_ID = 'test-client-id'
        const { api } = await import('../index.js')
        expect(typeof api).toBe('function')
        expect(JSON.stringify(api.__endpoint ?? api.__trigger)).toContain('us-central1')
    })
})
