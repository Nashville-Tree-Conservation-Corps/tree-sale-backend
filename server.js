require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())

const PORT = process.env.PORT || 3000

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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})