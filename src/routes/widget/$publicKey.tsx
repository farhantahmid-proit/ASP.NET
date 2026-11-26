import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { apiFetch } from '@/api/client'
import { MESSAGE_SOURCE, isHostEvent, readEmbedContext, type WidgetEvent } from '@/embed/protocol'

export const Route = createFileRoute('/widget/$publicKey')({ component: FresnelWidgetPage })

type WidgetMetaResponse = {
  workspace: { id: string; name: string; slug: string }
  widget: { id: string; workspace_id: string; public_key: string; name: string; is_default: boolean }
}

function FresnelWidgetPage() {
  const { publicKey } = Route.useParams()
  const [{ embedded, parentOrigin, targetUrl: initialTarget }] = useState(() => readEmbedContext())
  const [targetUrl, setTargetUrl] = useState(initialTarget ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const metaQuery = useQuery({
    queryKey: ['widget', 'meta', publicKey],
    queryFn: () =>
      apiFetch<WidgetMetaResponse>(`/api/widget/${encodeURIComponent(publicKey)}/meta`, {
        fallbackError: 'Widget key not found.',
      }),
    retry: false,
  })

  const notify = (msg: WidgetEvent) => {
    if (!embedded || !parentOrigin) return
    window.parent.postMessage(msg, parentOrigin)
  }

  useEffect(() => {
    if (!embedded || !parentOrigin) return
    const send = (msg: WidgetEvent) => window.parent.postMessage(msg, parentOrigin)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return
      if (!isHostEvent(event.data)) return
      if (event.data.type === 'opened') {
        inputRef.current?.focus()
      } else if (event.data.type === 'run_audit' && event.data.targetUrl) {
        setTargetUrl(event.data.targetUrl)
      }
    }
    window.addEventListener('message', onMessage)
    send({ source: MESSAGE_SOURCE, type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [embedded, parentOrigin])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (embedded && event.key === 'Escape') {
      notify({ source: MESSAGE_SOURCE, type: 'close' })
    }
  }

  return (
    <section className="fr-widget-shell" onKeyDown={handleKeyDown}>
      <header className="fr-widget-header">
        <strong>{metaQuery.data?.widget.name ?? 'Fresnel Site Auditor'}</strong>
        <div className="fr-widget-header-actions">
          <span className="fr-badge">{publicKey.slice(0, 12)}…</span>
          {embedded && (
            <button
              type="button"
              className="fr-widget-close"
              onClick={() => notify({ source: MESSAGE_SOURCE, type: 'close' })}
              aria-label="Close widget"
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="fr-widget-body">
        {metaQuery.isError && (
          <p className="fr-error" role="alert">
            {metaQuery.error.message}
          </p>
        )}
        <label className="fr-label" htmlFor="widget-target">Target URL</label>
        <input
          ref={inputRef}
          id="widget-target"
          className="fr-input"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <p className="fr-muted">
          Live Web-Check, SiteOne Crawl, and Lighthouse streaming wire into this view in PR 5.
        </p>
      </div>
    </section>
  )
}
