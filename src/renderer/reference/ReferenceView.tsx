// Reference tab: workspace BibTeX search, citation insertion, load diagnostics (SPEC §6, UI-13).
import { useMemo, useState } from 'react'
import { matchesQuery } from '../../shared/search/tokenizer'
import { insertCitation } from '../common/Dialogs'
import { openCitation } from '../store/actions'
import { reloadSnapshot, toast, useApp } from '../store/store'

export function ReferenceView() {
  const snapshot = useApp((s) => s.snapshot)!
  const selected = useApp((s) => (s.selectedNoteId ? s.snapshot?.state.notes[s.selectedNoteId] : undefined))
  const [q, setQ] = useState('')
  const bib = snapshot.bibliography
  const rows = useMemo(() => bib.entries.filter((r) => matchesQuery(`${r.key} ${r.author} ${r.year} ${r.title} ${r.container} ${r.doi}`, q)), [bib.entries, q])
  const reload = async () => {
    await reloadSnapshot(await window.facet.reloadBibliography(snapshot.id))
    toast('BibTeXを再読込しました')
  }
  const choose = async () => {
    const snap = await window.facet.chooseBibliography(snapshot.id)
    if (snap) {
      await reloadSnapshot(snap)
      toast('BibTeXファイルを設定しました')
    }
  }
  return (
    <div className="listview" data-testid="reference-view">
      <div className="view-header">
        <h1 className="heading">Reference</h1>
        <span className="helper">{bib.entries.length} entries</span>
      </div>
      <p className="subheading">
        WorkspaceのBibTeX（Zotero等からエクスポート、読み取り専用）: <span className="mono" data-testid="bib-source">{bib.source}</span>
        {bib.loadedAt && <> · 読込 {new Date(bib.loadedAt).toLocaleTimeString()}</>}
      </p>
      <div className="viewbar">
        <input className="input" style={{ maxWidth: 420 }} data-testid="reference-search" placeholder="著者・年・タイトル・引用キー・DOIで検索…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" data-testid="insert-citation" onClick={() => openCitation()}>
          ❞ Insert Citation
        </button>
        <button className="btn" data-testid="reload-bib" onClick={() => void reload()}>
          ↻ Reload
        </button>
        <button className="btn" data-testid="choose-bib" onClick={() => void choose()}>
          Choose .bib…
        </button>
        <button className="btn" onClick={() => void window.facet.openBibliographyFolder(snapshot.id)}>
          Open folder
        </button>
      </div>
      {bib.issues.length > 0 && (
        <div className="bib-issues" role="status" data-testid="bib-issues">
          {bib.issues.map((i, n) => (
            <div key={n} className={`bib-issue ${i.kind}`}>
              ⚠ {i.line ? `line ${i.line}: ` : ''}
              {i.message}
            </div>
          ))}
        </div>
      )}
      <table className="table" data-testid="reference-table">
        <thead>
          <tr>
            <th>Author / Year</th>
            <th>Title</th>
            <th>Citation key</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid="reference-row">
              <td>
                {r.author || '—'} ({r.year || 'n.d.'})
              </td>
              <td>
                {r.title}
                <div className="helper">
                  {r.container}
                  {r.doi && <> · doi:{r.doi}</>}
                </div>
              </td>
              <td>
                <code>[@{r.key}]</code>
              </td>
              <td>
                <button
                  className="btn tiny"
                  disabled={!selected}
                  title={selected ? `「${selected.title}」のカーソル位置へ挿入` : 'メモを選択してください'}
                  data-testid="insert-row-citation"
                  onClick={() => selected && void insertCitation(selected.id, r.key)}
                >
                  Insert
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">{bib.entries.length ? '該当する文献がありません' : 'BibTeXが読み込まれていません'}</div>}
    </div>
  )
}
