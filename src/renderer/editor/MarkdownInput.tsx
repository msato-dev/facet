// A CodeMirror Markdown field that is not bound to a note (no autosave): used by the new-note dialog.
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { autocompletion } from '@codemirror/autocomplete'
import { markdownBase, wikiCompletion } from './markdownExtensions'

interface Props {
  onChange: (value: string) => void
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void
  ariaLabel: string
  testId: string
  minHeight?: number
}

export function MarkdownInput({ onChange, onSubmit, ariaLabel, testId, minHeight = 160 }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onSubmit })
  callbacks.current = { onChange, onSubmit }

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: [
          autocompletion({ override: [wikiCompletion(null)], icons: false }),
          history(),
          keymap.of([
            { key: 'Mod-Enter', run: () => (callbacks.current.onSubmit?.(), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          ...markdownBase(),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'data-testid': testId }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    return () => view.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="md-editor-host" style={{ minHeight }} />
}
