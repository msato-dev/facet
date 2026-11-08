import type { FacetApi } from '../shared/ipc/contract'

declare global {
  interface Window {
    facet: FacetApi
  }
}

export {}
