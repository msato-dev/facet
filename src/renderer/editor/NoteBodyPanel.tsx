// Full-text Markdown editing below a card (Cards) or a note on the Canvas (ADR-034).
import { MarkdownEditor } from './MarkdownEditor'

interface Props {
  noteId: string
  /** Test id of the editor body; the panel is `<testId>-panel`, the close button `<testId>-close`. */
  testId: string
  onClose: () => void
  className?: string
}

/**
 * The same MarkdownEditor as the right pane (autosave, conflicts, drafts, [[ completion, citations).
 * `nodrag nopan nowheel` keep React Flow from dragging, panning or zooming while editing. The panel
 * is placed next to — not inside — the clickable or draggable card, and carries no `data-note-id`.
 */
export function NoteBodyPanel({ noteId, testId, onClose, className = '' }: Props) {
  return (
    <div
      className={`note-expand nodrag nopan nowheel ${className}`}
      data-testid={`${testId}-panel`}
      data-expanded-note={noteId}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keep Enter/Space for the editor instead of toggling the card around it.
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
        if (e.key === 'Escape' && !e.defaultPrevented) {
          // (Escape that closed a completion list is already handled.)
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="row note-expand-head">
        <span className="helper">全文 · Markdown（自動保存）</span>
        <span className="grow" />
        <button className="btn small" data-testid={`${testId}-close`} onClick={onClose}>
          Close
        </button>
      </div>
      <MarkdownEditor noteId={noteId} minHeight={120} testId={testId} />
    </div>
  )
}
