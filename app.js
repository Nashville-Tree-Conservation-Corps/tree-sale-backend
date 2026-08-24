const express = require('express')
const cors = require('cors')
const { authMiddleware } = require('./auth')

const app = express()

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

// Everything under /api requires a Firebase ID token from an allowlisted user
app.use('/api', authMiddleware)

// Get ALL orders (with optional status filter)
app.get('/api/orders', async (req, res) => {
    try {
        const { status } = req.query
        const { orders, errorStatus } = await fetchAllOrders(status ? `?fulfillmentStatus=${status}` : '')

        if (errorStatus) {
            return res.status(errorStatus).json({ error: 'Squarespace API error' })
        }

        const simplified = orders.map(order => ({
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
        const { orders, errorStatus } = await fetchAllOrders(`?customerId=${req.params.customerId}`)

        if (errorStatus) {
            return res.status(errorStatus).json({ error: 'Squarespace API error' })
        }

        const simplified = orders.map(order => ({
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

// A sale season runs July 1 through June 30 and is named "2026-2027"
function seasonOf(createdOn) {
    const date = new Date(createdOn)
    const year = date.getUTCFullYear()
    return date.getUTCMonth() >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

function isValidSeason(value) {
    const match = /^(\d{4})-(\d{4})$/.exec(value)
    return match !== null && Number(match[2]) === Number(match[1]) + 1
}

// Follows Squarespace's cursor pagination. `query` applies to the first
// request only: the cursor encodes the original filter, and Squarespace
// rejects cursors combined with other parameters.
async function fetchAllOrders(query = '') {
    const orders = []
    let cursor = null

    do {
        const url = cursor
            ? `https://api.squarespace.com/1.0/commerce/orders?cursor=${cursor}`
            : `https://api.squarespace.com/1.0/commerce/orders${query}`

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.SQUARESPACE_API_KEY}`,
                'User-Agent': 'tree-sale-app'
            }
        })

        if (!response.ok) {
            return { errorStatus: response.status }
        }

        const data = await response.json()
        orders.push(...data.result)
        cursor = data.pagination?.hasNextPage ? data.pagination.nextPageCursor : null
    } while (cursor)

    return { orders }
}

// Per-season sales stats plus a per-product breakdown, ranked most to least sold
app.get('/api/sales', async (req, res) => {
    const requestedSeason = req.query.season

    if (requestedSeason !== undefined && !isValidSeason(requestedSeason)) {
        return res.status(400).json({ error: 'Invalid season' })
    }

    try {
        const { orders, errorStatus } = await fetchAllOrders()

        if (errorStatus) {
            return res.status(errorStatus).json({ error: 'Squarespace API error' })
        }

        const bySeason = {}

        for (const order of orders) {
            const season = seasonOf(order.createdOn)
            bySeason[season] ??= {
                totalOrders: 0,
                fulfilledOrders: 0,
                unfulfilledOrders: 0,
                canceledOrders: 0,
                treesSold: 0,
                treeTotals: {}
            }
            const stats = bySeason[season]

            if (order.fulfillmentStatus === 'CANCELED') {
                stats.canceledOrders += 1
                continue
            }

            stats.totalOrders += 1
            if (order.fulfillmentStatus === 'FULFILLED') {
                stats.fulfilledOrders += 1
            } else {
                stats.unfulfilledOrders += 1
            }

            for (const item of order.lineItems) {
                if (item.productName.toLowerCase().includes('planting')) continue
                stats.treeTotals[item.productName] = (stats.treeTotals[item.productName] || 0) + item.quantity
                stats.treesSold += item.quantity
            }
        }

        const seasons = Object.keys(bySeason).sort().reverse()
        const season = requestedSeason ?? (seasons[0] || seasonOf(new Date().toISOString()))
        const stats = bySeason[season] ?? {
            totalOrders: 0,
            fulfilledOrders: 0,
            unfulfilledOrders: 0,
            canceledOrders: 0,
            treesSold: 0,
            treeTotals: {}
        }

        const byTree = Object.entries(stats.treeTotals)
            .map(([name, quantity]) => ({ name, quantity }))
            .sort((a, b) => b.quantity - a.quantity)

        res.json({
            season,
            seasons,
            totalOrders: stats.totalOrders,
            fulfilledOrders: stats.fulfilledOrders,
            unfulfilledOrders: stats.unfulfilledOrders,
            canceledOrders: stats.canceledOrders,
            treesSold: stats.treesSold,
            byTree
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({ error: 'Server error fetching sales data' })
    }
})

module.exports = app
