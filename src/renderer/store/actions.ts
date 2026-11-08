// User-level operations shared by Canvas, Outline and Cards.
import type { Point } from '../../shared/domain/types'
import { findNoteLocation, manuscriptNoteIds } from '../../shared/domain/structure'
import { confirmAction, exec, openDialog, promptText, selectNote, targetNoteIds, toast, undo, useApp } from './store'

const get = useApp.getState

export async function createNote(opts: { groupId?: string; canvasPos?: Point } = {}): Promise<string | null> {
  const title = await promptText('新規メモ', { label: 'タイトル', okLabel: '作成' })
  if (title === null) return null
  const r = await exec({ type: 'note.create', title, groupId: opts.groupId, canvasPos: opts.canvasPos })
  if (!r.ok || !r.info.createdId) return null
  selectNote(r.info.createdId, opts.groupId ?? null)
  useApp.setState({ rightOpen: true })
  toast(opts.groupId ? 'メモを作成しました' : '未配置メモを作成しました')
  return r.info.createdId
}

export async function createGroup(opts: { sectionId?: string | null; canvasPos?: Point; noteIds?: string[] } = {}): Promise<string | null> {
  const title = await promptText('Paragraph Group', { label: 'タイトル（原稿には出力されません）', okLabel: '作成' })
  if (title === null) return null
  const scope = get().scope
  const sectionId = opts.sectionId !== undefined ? opts.sectionId : scope !== 'all' && scope !== 'unassigned' ? scope : null
  const r = await exec({ type: 'group.create', title, sectionId, noteIds: opts.noteIds, canvasPos: opts.canvasPos })
  if (!r.ok) return null
  useApp.setState({ selectedGroupId: r.info.createdId ?? null, multiSelect: false, selectedNoteIds: [] })
  toast(sectionId ? 'Paragraph Groupを作成しました' : 'Paragraph Groupを作成しました（章節未配置）')
  return r.info.createdId ?? null
}

export async function createSection(parentId: string | null): Promise<void> {
  const title = await promptText(parentId ? '新しい節' : '新しい章', { label: 'タイトル（番号は自動）', okLabel: '作成' })
  if (title === null) return
  await exec({ type: 'section.create', title, parentId })
}

export async function deleteNotes(ids = targetNoteIds()): Promise<void> {
  const snap = get().snapshot
  if (!snap || !ids.length) return toast('メモを選択してください', 'error')
  const titles = ids.map((id) => snap.state.notes[id]?.title).filter(Boolean)
  const ok = await confirmAction(
    'メモを削除',
    ids.length === 1 ? `「${titles[0]}」を削除しますか？ Vault内のゴミ箱へ移動し、後で復元できます。` : `${ids.length}件のメモを削除しますか？ Vault内のゴミ箱へ移動します。`,
    { okLabel: '削除', danger: true },
  )
  if (!ok) return
  const r = await exec({ type: 'note.trash', ids })
  if (!r.ok) return
  useApp.setState({ selectedNoteId: null, selectedNoteIds: [] })
  toast('メモをゴミ箱へ移動しました', 'info', { label: 'Undo', run: () => void undo() })
}

export async function toggleArchive(ids = targetNoteIds()): Promise<void> {
  const snap = get().snapshot
  if (!snap || !ids.length) return toast('メモを選択してください', 'error')
  const allArchived = ids.every((id) => snap.state.notes[id]?.archived)
  if (allArchived) {
    const restorable = ids.some((id) => snap.state.notes[id]?.lastPlacement)
    const restore = restorable ? await confirmAction('アーカイブを解除', '元のParagraph Groupの位置へ戻しますか？（キャンセルで未配置として復元）', { okLabel: '元の位置へ戻す' }) : false
    const r = await exec({ type: 'note.unarchive', ids, restorePlacement: restore })
    if (r.ok) toast('アーカイブを解除しました')
  } else {
    const r = await exec({ type: 'note.archive', ids: ids.filter((id) => !snap.state.notes[id]?.archived) })
    if (r.ok) toast('メモをアーカイブしました（Cardsの「Archived」で表示・復元できます）', 'info', { label: 'Undo', run: () => void undo() })
  }
}

export function copyNote(): void {
  const s = get()
  const id = targetNoteIds()[0]
  if (!id || !s.activeId) return toast('メモを選択してください', 'error')
  useApp.setState({ clipboard: { workspaceId: s.activeId, noteId: id } })
  toast('メモをコピーしました')
}

export async function pasteNote(canvasPos?: Point): Promise<void> {
  const s = get()
  if (!s.clipboard || !s.activeId) return toast('コピーされたメモがありません', 'error')
  if (s.clipboard.workspaceId === s.activeId) {
    if (!s.snapshot?.state.notes[s.clipboard.noteId]) return toast('コピー元のメモが見つかりません', 'error')
    const r = await exec({ type: 'note.duplicate', id: s.clipboard.noteId, canvasPos })
    if (r.ok && r.info.createdId) {
      selectNote(r.info.createdId)
      toast('独立したメモとして貼り付けました')
    }
    return
  }
  const r = await window.facet.copyNoteToWorkspace(s.clipboard.workspaceId, s.clipboard.noteId, s.activeId)
  if (!r.ok) return toast(r.message, 'error')
  const snap = await window.facet.openWorkspace(s.activeId)
  if (snap.ok) useApp.setState({ snapshot: snap.snapshot, selectedNoteId: r.noteId ?? null })
  if (r.noteId && canvasPos) await exec({ type: 'canvas.setNotePos', id: r.noteId, pos: canvasPos })
  toast(r.message)
}

export function openCitation(noteId = get().selectedNoteId): void {
  if (!noteId) return toast('引用を挿入するメモを選択してください', 'error')
  openDialog({ kind: 'citation', noteId })
}

export async function unplaceNote(id: string): Promise<void> {
  await exec({ type: 'note.move', id, target: { kind: 'unassigned' } })
}

export function isInManuscript(id: string): boolean {
  const snap = get().snapshot
  return !!snap && manuscriptNoteIds(snap.state.structure).has(id)
}

export function groupOfNote(id: string): string | null {
  const snap = get().snapshot
  return snap ? (findNoteLocation(snap.state.structure, id)?.group.id ?? null) : null
}
