require('dotenv').config({ path: ['.env.local', '.env'] })

const REQUIRED_ENV = ['SQUARESPACE_API_KEY', 'GOOGLE_CLOUD_PROJECT']

const missing = REQUIRED_ENV.filter(name => !process.env[name])

if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
}

const app = require('./app')

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
})
