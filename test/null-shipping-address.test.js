import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv, mockFetchOrders, squarespaceOrder } from './helpers.js'

applyTestEnv()

// require, not import — see protected-routes.test.js for why.
const app = require('../app.js')
const { deps } = require('../auth.js')

// Squarespace returns shippingAddress: null on orders with nothing to ship
// (in-person pickup, digital goods). The order routes must not 500 on them.
describe('orders without a shipping address', () => {
    beforeEach(() => {
        applyTestEnv()
        deps.verifyIdToken = vi.fn().mockResolvedValue({
            uid: 'uid-1',
            email: 'staff@treeconservationcorps.org',
            email_verified: true
        })
        deps.isPinned = vi.fn().mockResolvedValue(true)
        deps.claim = vi.fn().mockResolvedValue(false)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    const pickupOrder = () => squarespaceOrder({
        shippingAddress: null,
        billingAddress: {
            firstName: 'Sam',
            lastName: 'Pickup',
            address1: '2 Elm St',
            postalCode: '55402',
            city: 'St Paul',
            state: 'MN'
        }
    })

    it('falls back to the billing address on /api/orders', async () => {
        mockFetchOrders([pickupOrder()])

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body[0].customerName).toBe('Sam Pickup')
        expect(res.body[0].zipCode).toBe('55402')
        expect(res.body[0].city).toBe('St Paul')
        expect(res.body[0].state).toBe('MN')
    })

    it('falls back to the billing address on /api/customers/:customerId/orders', async () => {
        mockFetchOrders([pickupOrder()])

        const res = await request(app)
            .get('/api/customers/cust-1/orders')
            .set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body[0].customerName).toBe('Sam Pickup')
    })

    it('falls back to the billing address on /api/orders/:id', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, status: 200, json: async () => pickupOrder() }))
        )

        const res = await request(app)
            .get('/api/orders/order-1')
            .set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        expect(res.body.customerName).toBe('Sam Pickup')
        expect(res.body.address).toBe('2 Elm St')
    })

    it('serves placeholders when both addresses are missing', async () => {
        mockFetchOrders([squarespaceOrder({ shippingAddress: null })])

        const res = await request(app).get('/api/orders').set('Authorization', 'Bearer good')

        expect(res.status).toBe(200)
        // customerName must stay a string: the frontend calls .localeCompare
        // and .toUpperCase() on it.
        expect(res.body[0].customerName).toBe('Unknown')
        expect(res.body[0].zipCode).toBe(null)
        expect(res.body[0].city).toBe(null)
        expect(res.body[0].state).toBe(null)
    })
})
