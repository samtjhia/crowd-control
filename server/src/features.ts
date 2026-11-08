/** PROD is independent of NODE_ENV so a deployed build can still opt into AI. */
export function geminiEnabled(prod: string | undefined): boolean {
  const value = (prod ?? 'FALSE').trim().toUpperCase();
  if (value !== 'TRUE' && value !== 'FALSE') throw new Error('PROD must be TRUE or FALSE.');
  return value === 'FALSE';
}

export function isGeminiGeneration(method: string | undefined, url: string | undefined): boolean {
  const path = url?.split('?')[0];
  return method === 'POST' && (path === '/api/plan' || /^\/api\/runs\/[^/]+\/report$/.test(path ?? ''));
}
