import { SessionKit } from '@wharfkit/session'
import { WebRenderer } from '@wharfkit/web-renderer'
import { WalletPluginAnchor } from '@wharfkit/wallet-plugin-anchor'
import { WalletPluginCloudWallet } from '@wharfkit/wallet-plugin-cloudwallet'
import { WalletPluginWombat } from '@wharfkit/wallet-plugin-wombat'

const WAX_CHAIN = {
  id: '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4',
  url: 'https://wax.greymass.com'
}

const walletPlugins = {
  anchor: new WalletPluginAnchor(),
  wombat: new WalletPluginWombat(),
  waxcloudwallet: new WalletPluginCloudWallet({
    supportedChains: [WAX_CHAIN.id],
    url: 'https://www.mycloudwallet.com',
    autoUrl: 'https://idm-api.mycloudwallet.com/v1/accounts/auto-accept',
    loginTimeout: 300000,
    mobileAppConnectConfig: {
      dappInfo: {
        name: 'Planetary Defense Multi-Tool',
        description: 'Planetary Defense wallet actions, blends, and payments.'
      }
    }
  })
}

const sessionKit = new SessionKit({
  appName: 'Planetary Defense Multi-Tool',
  chains: [WAX_CHAIN],
  ui: new WebRenderer(),
  walletPlugins: Object.values(walletPlugins)
})

let activeSession = null
let activeProvider = ''

function sessionActor(session = activeSession) {
  return String(session?.actor || session?.permissionLevel?.actor || '').trim()
}

function sessionPermission(session = activeSession) {
  return String(session?.permission || session?.permissionLevel?.permission || 'active').trim() || 'active'
}

function providerFromSession(session = activeSession) {
  const id = String(session?.walletPlugin?.id || session?.walletPlugin?.metadata?.id || '').toLowerCase()
  if (id.includes('wombat')) return 'wombat'
  if (id.includes('cloud')) return 'waxcloudwallet'
  if (id.includes('anchor')) return 'anchor'
  return activeProvider || ''
}

async function connect(provider) {
  const walletPlugin = walletPlugins[provider]
  if (!walletPlugin) throw new Error(`Unsupported wallet provider: ${provider}`)

  const result = await sessionKit.login({
    chain: WAX_CHAIN.id,
    walletPlugin: walletPlugin.id
  })

  activeSession = result.session
  activeProvider = provider
  return {
    account: sessionActor(activeSession),
    permission: sessionPermission(activeSession),
    provider: activeProvider,
    session: activeSession
  }
}

async function restore() {
  activeSession = await sessionKit.restore()
  activeProvider = providerFromSession(activeSession)
  if (!activeSession) return null
  return {
    account: sessionActor(activeSession),
    permission: sessionPermission(activeSession),
    provider: activeProvider,
    session: activeSession
  }
}

async function disconnect() {
  if (activeSession) {
    await sessionKit.logout(activeSession)
  } else {
    await sessionKit.logout()
  }
  activeSession = null
  activeProvider = ''
}

async function transact(args, options = {}) {
  if (!activeSession) throw new Error('No wallet connected.')
  return activeSession.transact(args, {
    expireSeconds: 120,
    ...options
  })
}

function getState() {
  return {
    account: sessionActor(activeSession),
    permission: sessionPermission(activeSession),
    provider: activeProvider,
    session: activeSession
  }
}

const api = {
  chain: WAX_CHAIN,
  connect,
  restore,
  disconnect,
  transact,
  getState
}

window.__pdWharfWallet = api
window.__resolveWharfWalletReady?.(api)

export default api
