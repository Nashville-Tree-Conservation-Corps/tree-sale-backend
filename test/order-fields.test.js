import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv, mockFetchOrders, squarespaceOrder, flagStore } from './helpers.js'

applyTestEnv()

const app = require('../app.js')
const { deps } = require('../auth.js')

const get = (path) => request(app).get(path).set('Authorization', 'Bearer good')

describe('order number, item kinds, and 811 flag', () => {
    beforeEach(() => {
        applyTestEnv()
        deps.verifyIdToken = vi.fn().mockResolvedValue({ uid: 'uid-1', email: 'a@b.org', email_verified: true })
        deps.isPinned = vi.fn().mockResolvedValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    const withGuard = squarespaceOrder({
        lineItems: [
            { productName: 'Red Maple', quantity: 2, unitPricePaid: { value: '45.00' } },
            { productName: 'Tree Guard', quantity: 3, unitPricePaid: { value: '10.00' } },
            { productName: 'Planting Service', quantity: 1, unitPricePaid: { value: '75.00' } }
        ]
    })

    it('returns the customer-facing order number alongside the backend id', async () => {
        mockFetchOrders([withGuard])
        const res = await get('/api/orders')
        expect(res.body[0].orderNumber).toBe('1042')
        expect(res.body[0].id).toBe('order-1')
    })

    it('counts only trees in totalQuantity and reports plantings and guards separately', async () => {
        mockFetchOrders([withGuard])
        const res = await get('/api/orders')
        expect(res.body[0]).toMatchObject({ totalQuantity: 2, plantingQuantity: 1, guardQuantity: 3, includesPlanting: true })
        expect(res.body[0].items.map(i => i.kind)).toEqual(['tree', 'guard', 'planting'])
    })

    it('PUT /api/orders/:id/811 saves the flag and the order endpoints report it', async () => {
        const put = await request(app).put('/api/orders/order-1/811').set('Authorization', 'Bearer good').send({ called: true })
        expect(put.status).toBe(200)
        expect(flagStore['order-1'].called811).toBe(true)

        mockFetchOrders([withGuard])
        expect((await get('/api/orders')).body[0].called811).toBe(true)
    })

    it('rejects a non-boolean 811 value', async () => {
        const res = await request(app).put('/api/orders/order-1/811').set('Authorization', 'Bearer good').send({ called: 'yes' })
        expect(res.status).toBe(400)
    })

    it('requires sign-in to set the 811 flag', async () => {
        deps.verifyIdToken = vi.fn().mockRejectedValue(new Error('bad'))
        const res = await request(app).put('/api/orders/order-1/811').send({ called: true })
        expect(res.status).toBe(401)
    })
})

describe('phone number', () => {
    beforeEach(() => {
        applyTestEnv()
        deps.verifyIdToken = vi.fn().mockResolvedValue({ uid: 'uid-1', email: 'a@b.org', email_verified: true })
        deps.isPinned = vi.fn().mockResolvedValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    const address = (phone) => ({
        firstName: 'Ada', lastName: 'Lovelace', address1: '1 Oak St',
        postalCode: '37206', city: 'Nashville', state: 'TN', phone
    })

    it('returns the shipping phone on the list and the single order', async () => {
        mockFetchOrders([squarespaceOrder({ shippingAddress: address('6155550123') })])
        expect((await get('/api/orders')).body[0].phone).toBe('6155550123')

        const single = squarespaceOrder({ shippingAddress: address('6155550123') })
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => single })))
        expect((await get('/api/orders/order-1')).body.phone).toBe('6155550123')
    })

    it('falls back to the billing phone when shipping has none', async () => {
        mockFetchOrders([squarespaceOrder({ shippingAddress: address(''), billingAddress: address('6155550199') })])
        expect((await get('/api/orders')).body[0].phone).toBe('6155550199')
    })

    it('is null when no phone is on file', async () => {
        mockFetchOrders([squarespaceOrder({ shippingAddress: null, billingAddress: null })])
        expect((await get('/api/orders')).body[0].phone).toBeNull()
    })
})
