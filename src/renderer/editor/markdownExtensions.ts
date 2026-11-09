// CodeMirror pieces shared by the note editor and the new-note dialog: theme, Markdown, [[ completion.
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useApp } from '../store/store'

export const BODY_PLACEHOLDER = 'Markdown本文… [[ でWikiLink、引用は [@Key]'

const wikiDecorator = new MatchDecorator({
  regexp: /\[\[[^[\]\n]+?\]\]/g,
  decoration: () => Decoration.mark({ class: 'cm-wikilink' }),
})
export const wikiHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = wikiDecorator.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = wikiDecorator.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

export const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--input-bg)',
      color: 'var(--ink)',
      fontSize: '12.5px',
      border: '1px solid var(--line-strong)',
      borderRadius: '5px',
    },
    '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
    '.cm-content': {
      fontFamily: 'var(--font)',
      lineHeight: '1.6',
      padding: '8px 2px',
      caretColor: 'var(--accent)',
    },
    '.cm-scroller': { fontFamily: 'var(--font)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: '#4a3b66 !important',
    },
    '.cm-wikilink': {
      color: 'var(--link)',
      textDecoration: 'underline',
      textDecorationColor: '#6b5a8c',
      cursor: 'pointer',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel-hi)',
      border: '1px solid var(--line-strong)',
      color: 'var(--ink)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent-bg)',
      color: 'var(--ink)',
    },
    '.cm-placeholder': { color: 'var(--muted)' },
  },
  { dark: true },
)

/** `[[` completion over the titles of the current workspace (excluding `selfId` and archived notes). */
export function wikiCompletion(selfId: string | null) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n|]*/)
    if (!m) return null
    const snap = useApp.getState().snapshot
    if (!snap) return null
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2)
    return {
      from: m.from + 2,
      options: Object.values(snap.state.notes)
        .filter((n) => n.id !== selfId && !n.archived)
        .map((n) => ({ label: n.title, type: 'text', apply: after === ']]' ? n.title : `${n.title}]]` })),
      validFor: /^[^[\]\n|]*$/,
    }
  }
}

/** Markdown language, wrapping, placeholder, WikiLink highlighting and the dark theme. */
export function markdownBase(placeholderText = BODY_PLACEHOLDER): Extension[] {
  return [markdown(), EditorView.lineWrapping, placeholder(placeholderText), wikiHighlight, editorTheme]
}
