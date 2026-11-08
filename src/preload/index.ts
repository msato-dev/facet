// Sandboxed preload: exposes a narrow, typed API. No Node access reaches the renderer.
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc/channels'
import type { FacetApi, WorkspaceEvent } from '../shared/ipc/contract'

const invoke =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args)

const api: FacetApi = {
  getInitialState: invoke(CH.getInitialState) as FacetApi['getInitialState'],
  openWorkspace: invoke(CH.openWorkspace) as FacetApi['openWorkspace'],
  execute: invoke(CH.execute) as FacetApi['execute'],
  undo: invoke(CH.undo) as FacetApi['undo'],
  redo: invoke(CH.redo) as FacetApi['redo'],
  restoreFromTrash: invoke(CH.restoreFromTrash) as FacetApi['restoreFromTrash'],
  copyNoteToWorkspace: invoke(CH.copyNoteToWorkspace) as FacetApi['copyNoteToWorkspace'],
  searchAll: invoke(CH.searchAll) as FacetApi['searchAll'],
  exportManuscript: invoke(CH.exportManuscript) as FacetApi['exportManuscript'],
  copyText: invoke(CH.copyText) as FacetApi['copyText'],
  reloadBibliography: invoke(CH.reloadBibliography) as FacetApi['reloadBibliography'],
  chooseBibliography: invoke(CH.chooseBibliography) as FacetApi['chooseBibliography'],
  openBibliographyFolder: invoke(CH.openBibliographyFolder) as FacetApi['openBibliographyFolder'],
  browseFolder: invoke(CH.browseFolder) as FacetApi['browseFolder'],
  validateVaultPath: invoke(CH.validateVaultPath) as FacetApi['validateVaultPath'],
  saveVaultLocations: invoke(CH.saveVaultLocations) as FacetApi['saveVaultLocations'],
  addWorkspace: invoke(CH.addWorkspace) as FacetApi['addWorkspace'],
  removeWorkspace: invoke(CH.removeWorkspace) as FacetApi['removeWorkspace'],
  setPanes: invoke(CH.setPanes) as FacetApi['setPanes'],
  setActiveWorkspace: invoke(CH.setActiveWorkspace) as FacetApi['setActiveWorkspace'],
  onWorkspaceEvent(cb) {
    const listener = (_e: unknown, payload: WorkspaceEvent) => cb(payload)
    ipcRenderer.on(CH.workspaceEvent, listener)
    return () => ipcRenderer.removeListener(CH.workspaceEvent, listener)
  },
}

contextBridge.exposeInMainWorld('facet', api)
