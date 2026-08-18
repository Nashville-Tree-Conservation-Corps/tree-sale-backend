const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')

process.env.GOOGLE_CLIENT_ID ??= '739923415388-vtq7qsf2d4u6q9lfis4i5ev3qjhpg68g.apps.googleusercontent.com'
process.env.GOOGLE_WORKSPACE_DOMAIN ??= 'treeconservationcorps.org'
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173'

const app = require('./app')

const squarespaceApiKey = defineSecret('SQUARESPACE_API_KEY')
const jwtSecret = defineSecret('JWT_SECRET')
const allowedEmails = defineSecret('ALLOWED_EMAILS')

exports.api = onRequest(
    { region: 'us-central1', secrets: [squarespaceApiKey, jwtSecret, allowedEmails] },
    app
)
