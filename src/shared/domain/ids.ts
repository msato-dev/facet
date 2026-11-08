import { ulid } from 'ulid'

/** Lower-case ULIDs: time-sortable, collision resistant, safe as file names on every OS. */
export function newId(): string {
  return ulid().toLowerCase()
}

export const ID_PATTERN = /^[0-9a-z]{26}$/

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}
