import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import cookieParser from 'cookie-parser'
import { OAuth2Client } from 'google-auth-library'
import mailchimp from '@mailchimp/mailchimp_marketing'

const app = express()

const PORT = process.env.PORT || 3000
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://sethub.io'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY || ''
const MAILCHIMP_SERVER_PREFIX = process.env.MAILCHIMP_SERVER_PREFIX || 'us15'
const MAILCHIMP_AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || ''
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret'

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}))

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

mailchimp.setConfig({
  apiKey: MAILCHIMP_API_KEY,
  server: MAILCHIMP_SERVER_PREFIX
})

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

function sha256LowerEmail(email){
  return crypto
    .createHash('sha256')
    .update(String(email || '').trim().toLowerCase())
    .digest('hex')
}

function signSession(user){
  const payload = Buffer.from(JSON.stringify(user)).toString('base64url')
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function readSession(token){
  if(!token || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')
  if(sig !== expected) return null

  try{
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  }catch{
    return null
  }
}

function setSessionCookie(res, user){
  const token = signSession(user)
  res.cookie('sethub_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 24 * 30
  })
}

async function upsertMailchimpContact({ email, firstName = '', lastName = '' }){
  const subscriberHash = sha256LowerEmail(email)

  await mailchimp.lists.setListMember(MAILCHIMP_AUDIENCE_ID, subscriberHash, {
    email_address: email,
    status_if_new: 'subscribed',
    status: 'subscribed',
    merge_fields: {
      FNAME: firstName,
      LNAME: lastName
    }
  })

  return true
}

function splitName(fullName){
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if(parts.length === 0) return { firstName: '', lastName: '' }
  if(parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.sethub_session
  const user = readSession(token)

  if(!user){
    return res.status(200).json({ ok: false })
  }

  res.json({
    ok: true,
    user
  })
})

app.post('/api/newsletter/subscribe', async (req, res) => {
  try{
    const email = String(req.body?.email || '').trim().toLowerCase()

    if(!email){
      return res.status(400).json({
        ok: false,
        message: 'Email fehlt'
      })
    }

    await upsertMailchimpContact({ email })

    return res.json({
      ok: true,
      message: 'Du wurdest für den Newsletter eingetragen'
    })
  }catch(error){
    console.error(error)
    return res.status(500).json({
      ok: false,
      message: 'Newsletter Anmeldung fehlgeschlagen'
    })
  }
})

app.post('/api/auth/google-subscribe', async (req, res) => {
  try{
    const credential = String(req.body?.credential || '')
    if(!credential){
      return res.status(400).json({
        ok: false,
        message: 'Google Credential fehlt'
      })
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    })

    const payload = ticket.getPayload()
    if(!payload?.email){
      return res.status(400).json({
        ok: false,
        message: 'Google Email nicht gefunden'
      })
    }

    const email = String(payload.email).trim().toLowerCase()
    const name = String(payload.name || '').trim()
    const { firstName, lastName } = splitName(name)

    await upsertMailchimpContact({
      email,
      firstName,
      lastName
    })

    const user = { name, email }
    setSessionCookie(res, user)

    return res.json({
      ok: true,
      message: 'Angemeldet und für News eingetragen',
      user
    })
  }catch(error){
    console.error(error)
    return res.status(500).json({
      ok: false,
      message: 'Google Anmeldung fehlgeschlagen'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`)
})