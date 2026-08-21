const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')

process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

const app = require('./app')

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY')

exports.api = onRequest(
    { region: 'us-central1', secrets: [squarespaceApiKey] },
    app
)
