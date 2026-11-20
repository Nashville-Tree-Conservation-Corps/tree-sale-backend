import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { applyTestEnv } from './helpers.js'

applyTestEnv()

const app = require('../app.js')
const { deps } = require('../auth.js')

const json = (status, body) => ({ ok: status < 300, status, json: async () => body })

const fulfill = () => request(app).post('/api/orders/order-1/fulfill').set('Authorization', 'Bearer good')

describe('POST /api/orders/:id/fulfill', () => {
    beforeEach(() => {
        applyTestEnv()
        deps.verifyIdToken = vi.fn().mockResolvedValue({ uid: 'u', email: 'a@b.org', email_verified: true })
        deps.isPinned = vi.fn().mockResolvedValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('fulfills a pending order without emailing the customer', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(json(200, { fulfillmentStatus: 'PENDING' }))
            .mockResolvedValueOnce(json(204))
        vi.stubGlobal('fetch', fetchMock)

        const res = await fulfill()

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ id: 'order-1', status: 'FULFILLED' })
        const [url, init] = fetchMock.mock.calls[1]
        expect(url).toBe('https://api.squarespace.com/1.0/commerce/orders/order-1/fulfillments')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ shouldSendNotification: false, shipments: [] })
    })

    it.each(['FULFILLED', 'CANCELED'])('refuses a %s order without calling Squarespace again', async (status) => {
        const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { fulfillmentStatus: status }))
        vi.stubGlobal('fetch', fetchMock)

        const res = await fulfill()

        expect(res.status).toBe(409)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('explains when the API key is read-only', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json(200, { fulfillmentStatus: 'PENDING' }))
            .mockResolvedValueOnce(json(403, {})))

        const res = await fulfill()

        expect(res.status).toBe(502)
        expect(res.body.error).toMatch(/read and write/i)
    })

    it('requires sign-in', async () => {
        deps.verifyIdToken = vi.fn().mockRejectedValue(new Error('bad'))
        const res = await request(app).post('/api/orders/order-1/fulfill')
        expect(res.status).toBe(401)
    })
})
