import {
  EMBED_PARAM,
  MESSAGE_SOURCE,
  PARENT_ORIGIN_PARAM,
  TARGET_URL_PARAM,
  isWidgetEvent,
  parseOrigin,
  type HostEvent,
} from './protocol'

type FresnelEventName = 'ready' | 'open' | 'close' | 'audit_started' | 'audit_completed'
type Listener = (payload?: unknown) => void

export interface FresnelAuditApi {
  readonly version: string
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  runAudit(targetUrl?: string): void
  on(event: FresnelEventName, listener: Listener): () => void
}

declare global {
  interface Window {
    FresnelAudit?: FresnelAuditApi
  }
}

const VERSION = '2.0.0'
const DEFAULT_COLOR = '#713fb9'
const DEFAULT_LABEL = 'Audit this site'
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function initFresnelEmbed() {
  if (window.FresnelAudit) return
  const script = document.currentScript as HTMLScriptElement | null
  const key = script?.dataset.key?.trim()
  if (!key) return

  const host = parseOrigin(script?.dataset.host) ?? parseOrigin(script?.src) ?? window.location.origin
  const color = HEX_COLOR.test(script?.dataset.color ?? '') ? script!.dataset.color! : DEFAULT_COLOR
  const label = script?.dataset.label?.trim() || DEFAULT_LABEL
  const position = script?.dataset.position === 'left' ? 'left' : 'right'
  const openOnLoad = script?.dataset.open === 'true'

  const rootHost = document.createElement('div')
  const shadow = rootHost.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .launcher {
      position: fixed; bottom: 16px; ${position}: 16px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px;
      border: 0; border-radius: 999px; background: ${color}; color: #fff;
      font: 600 14px/1 'Google Sans', system-ui, sans-serif;
      box-shadow: 0 8px 22px -4px rgba(113, 63, 185, 0.4); cursor: pointer;
    }
    .launcher:focus-visible { outline: 3px solid ${color}; outline-offset: 2px; }
    .frame-wrap {
      position: fixed; bottom: 72px; ${position}: 16px; z-index: 2147483000;
      width: min(420px, calc(100vw - 32px)); height: min(560px, calc(100vh - 96px));
      border-radius: 18px; overflow: hidden; display: none;
      box-shadow: 0 20px 48px -10px rgba(53, 26, 85, 0.28); border: 1px solid #d5d0f3; background: #fff;
    }
    .frame-wrap.open { display: block; }
    iframe { width: 100%; height: 100%; border: 0; }
  `

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'launcher'
  button.textContent = label
  button.setAttribute('aria-expanded', 'false')

  const wrap = document.createElement('div')
  wrap.className = 'frame-wrap'

  let iframe: HTMLIFrameElement | null = null
  let openState = false
  const listeners = new Map<FresnelEventName, Set<Listener>>()

  const emit = (event: FresnelEventName, payload?: unknown) => {
    listeners.get(event)?.forEach((fn) => fn(payload))
  }

  const postToIframe = (event: HostEvent) => {
    iframe?.contentWindow?.postMessage(event, host)
  }

  const ensureIframe = () => {
    if (iframe) return
    iframe = document.createElement('iframe')
    const url = new URL(`/widget/${encodeURIComponent(key)}`, host)
    url.searchParams.set(EMBED_PARAM, '1')
    url.searchParams.set(PARENT_ORIGIN_PARAM, window.location.origin)
    url.searchParams.set(TARGET_URL_PARAM, window.location.href)
    iframe.src = url.toString()
    iframe.title = 'Fresnel Site Auditor'
    wrap.appendChild(iframe)
  }

  const open = () => {
    ensureIframe()
    openState = true
    wrap.classList.add('open')
    button.setAttribute('aria-expanded', 'true')
    postToIframe({ source: MESSAGE_SOURCE, type: 'opened' })
    emit('open')
  }

  const close = () => {
    openState = false
    wrap.classList.remove('open')
    button.setAttribute('aria-expanded', 'false')
    postToIframe({ source: MESSAGE_SOURCE, type: 'closed' })
    emit('close')
  }

  button.addEventListener('click', () => (openState ? close() : open()))

  window.addEventListener('message', (event) => {
    if (event.origin !== host || event.source !== iframe?.contentWindow) return
    if (!isWidgetEvent(event.data)) return
    if (event.data.type === 'close') close()
    else if (event.data.type === 'ready') emit('ready')
    else emit(event.data.type, event.data)
  })

  shadow.append(style, wrap, button)
  document.body.appendChild(rootHost)

  if (openOnLoad) open()

  window.FresnelAudit = {
    version: VERSION,
    open,
    close,
    toggle: () => (openState ? close() : open()),
    isOpen: () => openState,
    runAudit: (targetUrl?: string) => {
      open()
      postToIframe({ source: MESSAGE_SOURCE, type: 'run_audit', targetUrl })
    },
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
  }
}

initFresnelEmbed()
