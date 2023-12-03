import SteamSession from "@waspyro/steam-session";
import {PersistormInstance} from "persistorm";
import SteamMobile from "@waspyro/steam-mobile";
import UserAgent from "user-agents";
import SteamWeb from "@waspyro/steam-web";
import {RequestOpts} from "@waspyro/steam-session/dist/common/types";
import {AtLeast} from "@waspyro/steam-web/dist/types";

type StartOpts = {
  store: PersistormInstance
  proxy: string,
  credentials: {
    login: string, password: string, shared: string, identity: string
  }
}

type CarryJar = ReturnType<SteamSession['cookies']['get']>

export default async function Start({store, credentials, proxy} = {} as AtLeast<StartOpts, 'store'>) {

  if(!credentials) {
    const saved = await store.get('credentials') || []
    credentials = {
      login: saved[0], password: saved[1],
      shared: saved[2], identity: saved[3]
    }
  }

  if(!credentials.login || !credentials.password)
    throw new Error('missing login or password')
  const sessionsStore = store.col('sessions')

  const mobile = await SteamMobile.fromRestoredSession({
    ...credentials,  proxy,
    store: sessionsStore.col('mobile'),
    env: checkMobileEnv
  })

  const web = await SteamWeb.fromRestoredSession({
    refresher: mobile.Refresher,
    forceAuthorized: true,
    store: sessionsStore.col('web'), proxy,
    env: checkWebEnv
  })

  const client = await SteamSession.restore({
    refresher: mobile.Refresher,
    store: sessionsStore.col('client'),
    env: oldEnv => oldEnv.meta.updated ? oldEnv : SteamSession.env.clientMacOS(),
  })

  const webProps = store.col('props')
  const savedProps = await webProps.geta({})
  for (const key in savedProps) web.setProp(key as any, savedProps[key])
  web.events.propUpdated.on(([name, value]) => webProps.set(name, value))

  const defaultRequestLogger = (
    login: string, sessionType: string,
    requestArgs: [URL, RequestOpts, CarryJar]
  ) => console.log('>', login, sessionType, requestArgs[0].toString())

  const useRequestLoggers = (logger = defaultRequestLogger) => {
    web.session.events.request.on((args) => logger(credentials.login, 'web', args))
    mobile.session.events.request.on((args) => logger(credentials.login, 'mobile', args))
    client.events.request.on((args) => logger(credentials.login, 'client', args))
  }

  return {store, mobile, web, client, helpers: {useRequestLoggers}}

}

const checkMobileEnv = (env) => {
  if (!env.meta.updated) env = SteamSession.env.mobileIOS()
  if (!env.meta.deviceid) {
    env.meta.deviceid = SteamMobile.randomDeviceID()
    env.meta.updated = Date.now()
  }
  return env
}

const checkWebEnv = (env) => {
  if(!env.meta.updated || !env.meta.viewport) {
    const ua = new UserAgent({deviceCategory: 'desktop'})
    env = SteamSession.env.webBrowser(ua.toString())
    env.meta.viewport = {
      width: ua.data.viewportWidth,
      height: ua.data.viewportHeight
    }
  }
  return env
}