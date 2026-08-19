const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { OAuth2Client } = require('google-auth-library')

const app = express()

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

const oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

// Exchange a Google ID token for a short-lived app JWT
app.post('/api/login', async (req, res) => {
    const credential = req.body && req.body.credential

    if (!credential) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    let payload
    try {
        const ticket = await oauthClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        })
        payload = ticket.getPayload()
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!payload) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    if (payload.email_verified !== true) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    const allowedEmails = (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)

    const email = (payload.email || '').toLowerCase()

    if (!allowedEmails.includes(email)) {
        return res.status(403).json({ error: 'Forbidden' })
    }

    const token = jwt.sign({ email: payload.email }, process.env.JWT_SECRET, { expiresIn: '12h' })

    res.json({ token })
})

// Everything under /api registered below this point requires the app JWT
app.use('/api', (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ')

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET)
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    next()
})

// Get ALL orders (with optional status filter)
app.get('/api/orders', async (req, res) => {
    try {
        const { status } = req.query
        let url = 'https://api.squarespace.com/1.0/commerce/orders'
        if (status) {
            url += `?fulfillmentStatus=${status}`
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Squarespace API error' })
        }

        const data = await response.json()

        const simplified = data.result.map(order => ({
            id: order.id,
            customerId: order.customerId,
            customerName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
            zipCode: order.shippingAddress.postalCode,
            city: order.shippingAddress.city,
            state: order.shippingAddress.state,
            date: order.createdOn,
            status: order.fulfillmentStatus,
            includesPlanting: order.lineItems.some(item =>
                item.productName.toLowerCase().includes("planting")
            ),
            hasDiscount: order.discountLines && order.discountLines.length > 0,
            items: order.lineItems.map(item => ({
                name: item.productName,
                quantity: item.quantity,
                price: item.unitPricePaid.value
            })),
            totalQuantity: order.lineItems.reduce((sum, item) => sum + item.quantity, 0),
            total: order.grandTotal.value
        }))

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching orders' })
    }
})

// Get ONE specific order by id
app.get('/api/orders/:id', async (req, res) => {
    try {
        const response = await fetch(`https://api.squarespace.com/1.0/commerce/orders/${req.params.id}`, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Squarespace API error' })
        }

        const order = await response.json()

        const simplified = {
            id: order.id,
            customerId: order.customerId,
            customerName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
            address: order.shippingAddress.address1,
            zipCode: order.shippingAddress.postalCode,
            city: order.shippingAddress.city,
            state: order.shippingAddress.state,
            date: order.createdOn,
            status: order.fulfillmentStatus,
            includesPlanting: order.lineItems.some(item =>
                item.productName.toLowerCase().includes("planting")
            ),
            hasDiscount: order.discountLines && order.discountLines.length > 0,
            notes: order.internalNotes?.map(n => n.content).join(", ") || "No notes",
            items: order.lineItems.map(item => ({
                name: item.productName,
                quantity: item.quantity,
                price: item.unitPricePaid.value
            })),
            totalQuantity: order.lineItems.reduce((sum, item) => sum + item.quantity, 0),
            total: order.grandTotal.value
        }

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching order' })
    }
})

// Get all orders for a specific customer
app.get('/api/customers/:customerId/orders', async (req, res) => {
    try {
        const response = await fetch(`https://api.squarespace.com/1.0/commerce/orders?customerId=${req.params.customerId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Squarespace API error' })
        }

        const data = await response.json()

        const simplified = data.result.map(order => ({
            id: order.id,
            customerId: order.customerId,
            customerName: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
            zipCode: order.shippingAddress.postalCode,
            city: order.shippingAddress.city,
            state: order.shippingAddress.state,
            date: order.createdOn,
            status: order.fulfillmentStatus,
            includesPlanting: order.lineItems.some(item =>   // ← Add this
                item.productName.toLowerCase().includes("planting")
            ),
            hasDiscount: order.discountLines && order.discountLines.length > 0,
            items: order.lineItems.map(item => ({
                name: item.productName,
                quantity: item.quantity,
                price: item.unitPricePaid.value
            })),
            totalQuantity: order.lineItems.reduce((sum, item) => sum + item.quantity, 0),
            total: order.grandTotal.value
        }))

        res.json(simplified)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching customer orders' })
    }
})

// Get total quantity sold per product, ranked most to least
app.get('/api/sales', async (req, res) => {
    try {
        const response = await fetch('https://api.squarespace.com/1.0/commerce/orders', {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Squarespace API error' })
        }

        const data = await response.json()

        // Tally quantity sold per product name, skipping the planting service
        const totals = {}

        for (const order of data.result) {
            for (const item of order.lineItems) {
                const name = item.productName
                if (name.toLowerCase().includes("planting")) continue

                if (!totals[name]) {
                    totals[name] = 0
                }
                totals[name] += item.quantity
            }
        }

        // Convert to an array and sort most sold → least sold
        const sorted = Object.entries(totals)
            .map(([name, quantity]) => ({ name, quantity }))
            .sort((a, b) => b.quantity - a.quantity)

        res.json(sorted)
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching sales data' })
    }
})

module.exports = app
