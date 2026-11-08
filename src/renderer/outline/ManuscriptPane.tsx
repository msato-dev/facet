// Manuscript preview: read-only, regenerated from the structure on every change (SPEC §4.1).
import { useDeferredValue, useMemo } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { generateManuscript, manuscriptToMarkdown, type Manuscript } from '../../shared/markdown/manuscript'
import { openDialog, toast, useApp } from '../store/store'

const rawPipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify)
const rawCache = new Map<string, string>()
function renderRaw(md: string): string {
  let html = rawCache.get(md)
  if (html === undefined) {
    html = String(rawPipeline.processSync(md))
    if (rawCache.size > 500) rawCache.clear()
    rawCache.set(md, html)
  }
  return html
}

export function useManuscript(): Manuscript | null {
  const state = useApp((s) => s.snapshot?.state)
  const deferred = useDeferredValue(state)
  return useMemo(() => (deferred ? generateManuscript(deferred) : null), [deferred])
}

export async function copyManuscript(m: Manuscript): Promise<void> {
  await window.facet.copyText(manuscriptToMarkdown(m))
  toast('Markdownをコピーしました')
}

export async function exportManuscript(m: Manuscript): Promise<void> {
  const id = useApp.getState().activeId
  if (!id) return
  const r = await window.facet.exportManuscript(id, manuscriptToMarkdown(m))
  toast(r.message, r.ok ? 'info' : 'error')
}

export function ManuscriptDocument() {
  const m = useManuscript()
  if (!m) return null
  return (
    <article className="manuscript" data-testid="manuscript">
      {m.blocks.length === 0 && (
        <p className="helper">
          原稿に配置されたメモはまだありません。Outlineで章節とParagraph Groupにメモを配置してください。
        </p>
      )}
      {m.blocks.map((b, i) => {
        if (b.type === 'heading') {
          const H = `h${Math.min(6, b.depth + 1)}` as 'h2'
          return <H key={i}>{b.text}</H>
        }
        if (b.type === 'paragraph') return <p key={i}>{b.text}</p>
        return (
          <div
            key={i}
            className="ms-raw"
            title="結合せず原文のまま出力（警告参照）"
            dangerouslySetInnerHTML={{ __html: renderRaw(b.markdown) }}
          />
        )
      })}
    </article>
  )
}

export function ManuscriptPane({ onClose }: { onClose: () => void }) {
  const m = useManuscript()
  return (
    <section className="manuscript-split" data-testid="manuscript-split">
      <div className="manuscript-header">
        <strong>Manuscript</strong>
        <span className="helper">プレビュー専用 · Outlineと同期</span>
        <span className="grow" />
        <button className="btn small" data-testid="ms-copy" onClick={() => m && void copyManuscript(m)}>
          ⧉ Copy
        </button>
        <button className="btn small" data-testid="ms-export" onClick={() => m && void exportManuscript(m)}>
          ↓ Export .md
        </button>
        <button
          className="btn small"
          data-testid="ms-fullscreen"
          title="全画面"
          onClick={() => openDialog({ kind: 'manuscript-fullscreen' })}
        >
          ⤢
        </button>
        <button className="btn small" data-testid="ms-close" title="プレビューを閉じる" onClick={onClose}>
          ✕
        </button>
      </div>
      {m && m.warnings.length > 0 && (
        <details className="ms-warnings" data-testid="ms-warnings">
          <summary>⚠ {m.warnings.length}件のメモを結合せずに出力しました</summary>
          <ul>
            {m.warnings.map((w) => (
              <li key={w.noteId}>
                「{w.noteTitle}」: {w.reasons.join('・')}を含むため、原文のまま独立したブロックとして出力
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="manuscript-scroll">
        <ManuscriptDocument />
      </div>
    </section>
  )
}
