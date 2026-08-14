const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const app = require('./app')

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY')
const jwtSecret = defineSecret('JWT_SECRET')
const allowedEmails = defineSecret('ALLOWED_EMAILS')

exports.api = onRequest(
    { region: 'us-central1', secrets: [squarespaceApiKey, jwtSecret, allowedEmails] },
    app
)
