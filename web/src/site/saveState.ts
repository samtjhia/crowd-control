/** Whether the current run is being saved to the account, shown on the avatar and in the menu. */
export type SaveState =
  | { kind: 'off' }
  | { kind: 'waiting' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }
