import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  execFileSync('cargo', ['build', '--locked', '-p', 'crowd-control-engine', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
} catch {
  console.error('Wasm build failed; see the compiler error above. If the target is missing, run: rustup target add wasm32-unknown-unknown');
  process.exit(1);
}
const output = new URL('../../web/public/engine/', import.meta.url);
mkdirSync(output, { recursive: true });
copyFileSync(new URL('../../target/wasm32-unknown-unknown/release/crowd_control_engine.wasm', import.meta.url), new URL('crowd_control_engine.wasm', output));
