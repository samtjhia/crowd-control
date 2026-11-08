import { createServer } from 'node:http';
import { SCHEMA_VERSION, type ContractError } from '@crowd-control/contract';
import { Pool } from 'pg';
import { createAuth0TokenVerifier } from './auth.ts';
import { deleteRun, deleteScenario, deleteVenue, listScenarios, saveScenario, getOwnedRuns, getRunAnalytics, getRunFacts, getRunReplay, getSavedReport, saveReport, initializeDatabase, listVenues, saveIntervention, saveMetricBatch, saveRun, saveVenue } from './database.ts';
import { createGeminiPlanner } from './planner.ts';
import { createReportWriter } from './report.ts';
import { geminiEnabled, isGeminiGeneration } from './features.ts';

const aiEnabled = geminiEnabled(process.env.PROD);

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const MAX_PLANNER_BODY_BYTES = 64 * 1024;
/** A saved floor plan carries its whole grid, so it may be much larger than other requests. */
const MAX_VENUE_BODY_BYTES = 8 * 1024 * 1024;
const verifyAccessToken = createAuth0TokenVerifier(
  process.env.AUTH0_DOMAIN,
  process.env.AUTH0_AUDIENCE,
);
const writeReport = createReportWriter({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
const plan = createGeminiPlanner({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
});
const database = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const databaseReady = database
  ? initializeDatabase(database).then(() => true).catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNKNOWN';
    console.error(`Tiger Data schema initialization failed (${code}).`);
    return false;
  })
  : Promise.resolve(false);

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.setHeader('Content-Type', 'application/json');
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: import('node:http').IncomingMessage, limit = MAX_PLANNER_BODY_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; error: ContractError }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > limit) {
      return { ok: false, error: { code: 'RESOURCE_LIMIT', message: `Request exceeds the ${Math.round(limit / 1024)} KiB limit.` } };
    }
    chunks.push(data);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'Request body must contain valid JSON.' } };
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error('API request failed unexpectedly:', error);
    if (!response.headersSent) {
      sendJson(response, 500, { ok: false, error: 'The API request failed unexpectedly.' });
    } else {
      response.destroy();
    }
  });
});

async function handleRequest(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok', schemaVersion: SCHEMA_VERSION });
    return;
  }

  if (request.method === 'GET' && request.url?.split('?')[0] === '/api/features') {
    response.setHeader('Cache-Control', 'no-store');
    sendJson(response, 200, { geminiEnabled: aiEnabled });
    return;
  }

  if (!aiEnabled && isGeminiGeneration(request.method, request.url)) {
    const message = 'AI features are disabled in production.';
    sendJson(response, 403, { ok: false, error: request.url?.split('?')[0] === '/api/plan'
      ? { code: 'PLANNER_UNAVAILABLE', message, retryable: false } : message });
    return;
  }

  let ownerSub = '';
  if (request.url?.split('?')[0]?.startsWith('/api/')) {
    if (!verifyAccessToken) {
      sendJson(response, 503, { ok: false, error: 'API authentication is not configured.' });
      return;
    }
    try {
      const verifiedSub = await verifyAccessToken(request.headers.authorization);
      if (!verifiedSub) {
        sendJson(response, 401, { ok: false, error: 'A valid Auth0 access token is required.' });
        return;
      }
      ownerSub = verifiedSub;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UNKNOWN';
      console.error(`Auth0 token verification failed (${errorName}).`);
      sendJson(response, 503, { ok: false, error: 'Auth0 token verification is temporarily unavailable.' });
      return;
    }
  }

  if (request.method === 'GET' && request.url === '/health/database') {
    void (async () => {
      if (!database) {
        sendJson(response, 503, { status: 'error', message: 'DATABASE_URL is not configured.' });
        return;
      }
      if (!await databaseReady) {
        sendJson(response, 503, { status: 'error', message: 'Tiger Data schema is not ready.' });
        return;
      }
      await database.query('SELECT 1');
      sendJson(response, 200, { status: 'ok', database: 'connected' });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Tiger Data connection check failed (${code}).`);
      sendJson(response, 503, { status: 'error', message: 'Could not connect to Tiger Data.' });
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/runs') {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        sendJson(response, 400, { ok: false, error: 'Content-Type must be application/json.' });
        return;
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        sendJson(response, 400, { ok: false, error: body.error.message });
        return;
      }
      if (!await saveRun(database, ownerSub, body.value)) {
        sendJson(response, 400, { ok: false, error: 'Invalid run record.' });
        return;
      }
      sendJson(response, 201, { ok: true });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Tiger Data run write failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not save the run to Tiger Data.' });
    });
    return;
  }

  const telemetryPath = request.url?.split('?')[0] ?? '';
  if (request.method === 'GET' && telemetryPath === '/api/runs') {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const runs = await getOwnedRuns(database, ownerSub);
      sendJson(response, 200, { ok: true, runs });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Tiger Data run history query failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not load past simulations from Tiger Data.' });
    });
    return;
  }

  const analyticsRoute = /^\/api\/runs\/([^/]+)\/analytics$/.exec(telemetryPath);
  if (request.method === 'GET' && analyticsRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const analytics = await getRunAnalytics(database, ownerSub, analyticsRoute[1]!);
      if (analytics === 'invalid') {
        sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' });
      } else if (analytics === null) {
        sendJson(response, 404, { ok: false, error: 'Run was not found.' });
      } else {
        sendJson(response, 200, { ok: true, analytics });
      }
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Tiger Data analytics query failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not load analytics from Tiger Data.' });
    });
    return;
  }

  // Deleting a run, with its measurements and changes; only the owner's own runs.
  const runRoute = /^\/api\/runs\/([^/]+)$/.exec(telemetryPath);
  if (request.method === 'DELETE' && runRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const deleted = await deleteRun(database, ownerSub, runRoute[1]!);
      if (deleted === 'invalid') sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' });
      else sendJson(response, deleted ? 200 : 404, deleted ? { ok: true } : { ok: false, error: 'Run was not found.' });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      console.error(`Tiger Data run delete failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not delete the run from Tiger Data.' });
    });
    return;
  }

  // The AI safety report for a run, written by Gemini from the run's measured facts.
  const reportRoute = /^\/api\/runs\/([^/]+)\/report$/.exec(telemetryPath);
  // The report written earlier for a run, without writing it again.
  if (request.method === 'GET' && reportRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const saved = await getSavedReport(database, ownerSub, reportRoute[1]!);
      if (saved === 'invalid') sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' });
      else if (saved === null) sendJson(response, 404, { ok: false, error: 'Run was not found.' });
      else if (saved === 'none') sendJson(response, 200, { ok: true, report: null });
      else sendJson(response, 200, { ok: true, ...saved });
    })().catch(() => sendJson(response, 503, { ok: false, error: 'Could not load the report from Tiger Data.' }));
    return;
  }
  if (request.method === 'POST' && reportRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const body = await readJsonBody(request);
      const metres = body.ok && typeof body.value === 'object' && body.value !== null && 'units' in body.value && body.value.units === 'm';
      const facts = await getRunFacts(database, ownerSub, reportRoute[1]!, metres ? 'people/m²' : 'relative');
      if (facts === 'invalid') { sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' }); return; }
      if (facts === null) { sendJson(response, 404, { ok: false, error: 'Run was not found.' }); return; }
      if (facts.measurements === 0) { sendJson(response, 422, { ok: false, error: 'This run has no measurements yet. Play it for a while first.' }); return; }
      const report = await writeReport(facts);
      if (report.ok) {
        await saveReport(database, ownerSub, reportRoute[1]!, report.value, facts);
        sendJson(response, 200, { ok: true, report: report.value, facts });
      }
      else sendJson(response, 503, { ok: false, error: report.error.message });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      console.error(`Safety report failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not write the report.' });
    });
    return;
  }

  const replayRoute = /^\/api\/runs\/([^/]+)\/replay$/.exec(telemetryPath);
  if (request.method === 'GET' && replayRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const replay = await getRunReplay(database, ownerSub, replayRoute[1]!);
      if (replay === 'invalid') sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' });
      else if (replay === null) sendJson(response, 404, { ok: false, error: 'Run was not found.' });
      else sendJson(response, 200, { ok: true, replay });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      console.error(`Tiger Data replay query failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not load the run from Tiger Data.' });
    });
    return;
  }

  const metricsRoute = /^\/api\/runs\/([^/]+)\/metrics$/.exec(telemetryPath);
  const interventionRoute = /^\/api\/runs\/([^/]+)\/interventions$/.exec(telemetryPath);
  if (request.method === 'POST' && (metricsRoute || interventionRoute)) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        sendJson(response, 400, { ok: false, error: 'Content-Type must be application/json.' });
        return;
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        sendJson(response, 400, { ok: false, error: body.error.message });
        return;
      }
      const result = metricsRoute
        ? await saveMetricBatch(database, ownerSub, metricsRoute[1]!, body.value)
        : await saveIntervention(database, ownerSub, interventionRoute![1]!, body.value);
      if (result === 'invalid') {
        sendJson(response, 400, { ok: false, error: 'Invalid telemetry payload.' });
      } else if (result === 'missing-run') {
        sendJson(response, 404, { ok: false, error: 'Run was not found.' });
      } else {
        sendJson(response, 202, { ok: true });
      }
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Tiger Data telemetry write failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not save telemetry to Tiger Data.' });
    });
    return;
  }

  // Scenarios the person kept (written by the assistant), per signed-in person.
  const scenarioRoute = /^\/api\/scenarios(?:\/([^/]+))?$/.exec(telemetryPath);
  if (scenarioRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const scenarioId = scenarioRoute[1] ? decodeURIComponent(scenarioRoute[1]) : undefined;
      if (request.method === 'GET' && !scenarioId) {
        sendJson(response, 200, { ok: true, scenarios: await listScenarios(database, ownerSub) });
      } else if (request.method === 'PUT' && scenarioId) {
        const body = await readJsonBody(request, MAX_VENUE_BODY_BYTES);
        if (!body.ok) { sendJson(response, body.error.code === 'RESOURCE_LIMIT' ? 413 : 400, { ok: false, error: body.error.message }); return; }
        const saved = await saveScenario(database, ownerSub, scenarioId, body.value);
        sendJson(response, saved === 'saved' ? 200 : 400, saved === 'saved' ? { ok: true } : { ok: false, error: 'Invalid scenario.' });
      } else if (request.method === 'DELETE' && scenarioId) {
        const deleted = await deleteScenario(database, ownerSub, scenarioId);
        if (deleted === 'invalid') sendJson(response, 400, { ok: false, error: 'Invalid scenario ID.' });
        else sendJson(response, deleted ? 200 : 404, deleted ? { ok: true } : { ok: false, error: 'Scenario was not found.' });
      } else {
        sendJson(response, 405, { ok: false, error: 'Method not allowed.' });
      }
    })().catch(() => sendJson(response, 503, { ok: false, error: 'Could not reach saved scenarios in Tiger Data.' }));
    return;
  }

  // Floor plans saved from the editor, per signed-in person.
  const venueRoute = /^\/api\/venues(?:\/([^/]+))?$/.exec(telemetryPath);
  if (venueRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const venueId = venueRoute[1] ? decodeURIComponent(venueRoute[1]) : undefined;
      if (request.method === 'GET' && !venueId) {
        sendJson(response, 200, { ok: true, venues: await listVenues(database, ownerSub) });
      } else if (request.method === 'PUT' && venueId) {
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          sendJson(response, 400, { ok: false, error: 'Content-Type must be application/json.' });
          return;
        }
        const body = await readJsonBody(request, MAX_VENUE_BODY_BYTES);
        if (!body.ok) {
          sendJson(response, body.error.code === 'RESOURCE_LIMIT' ? 413 : 400, { ok: false, error: body.error.message });
          return;
        }
        const saved = await saveVenue(database, ownerSub, venueId, body.value);
        sendJson(response, saved === 'saved' ? 200 : 400, saved === 'saved' ? { ok: true } : { ok: false, error: 'Invalid floor plan.' });
      } else if (request.method === 'DELETE' && venueId) {
        const deleted = await deleteVenue(database, ownerSub, venueId);
        if (deleted === 'invalid') sendJson(response, 400, { ok: false, error: 'Invalid floor plan ID.' });
        else sendJson(response, deleted ? 200 : 404, deleted ? { ok: true } : { ok: false, error: 'Floor plan was not found.' });
      } else {
        sendJson(response, 405, { ok: false, error: 'Method not allowed.' });
      }
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      console.error(`Tiger Data floor plan request failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not reach saved floor plans in Tiger Data.' });
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/plan') {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      sendJson(response, 400, { ok: false, error: { code: 'INVALID_SCHEMA', message: 'Content-Type must be application/json.' } });
      return;
    }
    void readJsonBody(request).then(async (body) => {
      if (!body.ok) {
        sendJson(response, 400, { ok: false, error: body.error });
        return;
      }
      const result = await plan(body.value);
      sendJson(response, result.ok ? 200 : result.error.code === 'INVALID_SCHEMA' ? 400 : 503, result);
    }).catch((error: unknown) => {
      console.error('Planner request failed unexpectedly:', error);
      sendJson(response, 500, { ok: false, error: { code: 'PLANNER_UNAVAILABLE', message: 'Planner request failed unexpectedly.', retryable: true } });
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

const host = process.env.HOST ?? '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Crowd Control API: http://${host}:${port}`);
});
