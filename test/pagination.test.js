import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv, mockFetchOrderPages, squarespaceOrder } from './helpers.js'

applyTestEnv()

// require (not import): see the module-identity note in protected-routes.test.js
const app = require('../app.js')
const { deps } = require('../auth.js')

function allowSignedInUser() {
    deps.verifyIdToken = vi.fn().mockResolvedValue({
        uid: 'uid-1',
        email: 'staff@treeconservationcorps.org',
        email_verified: true
    })
    deps.isPinned = vi.fn().mockResolvedValue(true)
    deps.claim = vi.fn().mockResolvedValue(false)
}

describe('Squarespace pagination on list routes', () => {
    beforeEach(() => {
        applyTestEnv()
        allowSignedInUser()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('/api/orders returns orders from every page', async () => {
        const fetchMock = mockFetchOrderPages([
            [squarespaceOrder({ id: 'order-1' })],
            [squarespaceOrder({ id: 'order-2' })]
        ])

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body.map(o => o.id)).toEqual(['order-1', 'order-2'])
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1')
    })

    it('/api/orders sends the status filter on the first request only', async () => {
        const fetchMock = mockFetchOrderPages([
            [squarespaceOrder({ id: 'order-1' })],
            [squarespaceOrder({ id: 'order-2' })]
        ])

        const res = await request(app).get('/api/orders?status=PENDING').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(fetchMock.mock.calls[0][0]).toContain('fulfillmentStatus=PENDING')
        expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1')
        expect(fetchMock.mock.calls[1][0]).not.toContain('fulfillmentStatus')
    })

    it('/api/customers/:customerId/orders returns orders from every page', async () => {
        const fetchMock = mockFetchOrderPages([
            [squarespaceOrder({ id: 'order-1' })],
            [squarespaceOrder({ id: 'order-2' })]
        ])

        const res = await request(app)
            .get('/api/customers/cust-1/orders')
            .set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body.map(o => o.id)).toEqual(['order-1', 'order-2'])
        expect(fetchMock.mock.calls[0][0]).toContain('customerId=cust-1')
        expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1')
        expect(fetchMock.mock.calls[1][0]).not.toContain('customerId')
    })

    it('surfaces a Squarespace error from a later page', async () => {
        let call = 0
        const fetchMock = vi.fn(async () => {
            call += 1
            if (call === 1) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        result: [squarespaceOrder({ id: 'order-1' })],
                        pagination: { hasNextPage: true, nextPageCursor: 'cursor-1' }
                    })
                }
            }
            return { ok: false, status: 429, json: async () => ({}) }
        })
        vi.stubGlobal('fetch', fetchMock)

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Squarespace API error' })
    })
})
