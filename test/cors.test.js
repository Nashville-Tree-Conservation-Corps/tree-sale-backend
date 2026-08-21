import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { applyTestEnv } from './helpers.js'

applyTestEnv()

const app = (await import('../app.js')).default

describe('CORS', () => {
    it.each(['https://tree-sale.example.com', 'http://localhost:5173'])(
        'allows %s from FRONTEND_ORIGIN',
        async (origin) => {
            const res = await request(app).options('/api/orders').set('Origin', origin)

            expect(res.headers['access-control-allow-origin']).toBe(origin)
        }
    )

    it('does not allow an origin outside FRONTEND_ORIGIN', async () => {
        const res = await request(app).options('/api/orders').set('Origin', 'https://evil.example.com')

        expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('does not allow every origin', async () => {
        const res = await request(app).options('/api/orders').set('Origin', 'https://evil.example.com')

        expect(res.headers['access-control-allow-origin']).not.toBe('*')
    })
})
