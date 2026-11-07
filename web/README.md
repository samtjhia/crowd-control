# Web

React + Vite app. Run `npm run dev` at the repository root.
The shared contract is built automatically before the dev server starts, and
Vite proxies `/api` requests to the local Node server.

B owns the shell, renderer and controls; C owns chat. The chat sends prompts to
the server-side Gemini planner and validates its replies against the shared
contract. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the root `.env` file; never
expose the key through a `VITE_` variable. The offline sample can be previewed
and loaded in the mock worker. Gemini-generated plans remain previews until the
compiler handoff is connected. Mock output is development data, not a safety
assessment.

After a follow-up is applied, its prompt, validated request, and worker
acknowledgement are saved in browser local storage and shown as an interaction
log after the sample is loaded again. The log does not restore or replay the
mock simulation; the simulation itself resets when the page is refreshed.

Scenario planning and running-simulation follow-ups use separate inputs. The
offline sample preview remains visible after loading, and the follow-up form is
shown directly inside the mock simulation panel.
