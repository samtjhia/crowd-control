// Vite supplies this public flag; API keys remain on the server.
declare const __GEMINI_ENABLED__: boolean
export const GEMINI_ENABLED = typeof __GEMINI_ENABLED__ === 'undefined' ? true : __GEMINI_ENABLED__
