import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve('dist/assets')
const assets = readdirSync(directory).filter(name => /\.(js|css)$/.test(name))
if (assets.length === 0) throw new Error('No production assets to inspect')
const forbidden = ['M_PORTAL_LOGIN_ACNT', 'LoginPWD', '__VIEWSTATE', 'fixture-pass', 'FAKE_VIEW_STATE', 'CookieJar', 'AIS_ACCOUNT', 'AIS_PASSWORD']
for (const name of assets) {
  const text = readFileSync(resolve(directory, name), 'utf8')
  for (const marker of forbidden) if (text.includes(marker)) throw new Error(`AIS server content found in browser asset: ${name}`)
}
console.log('PASS: browser assets exclude AIS credentials, protocol, cookies and raw fixtures.')
