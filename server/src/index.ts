import { createServer } from 'node:http';
import { SCHEMA_VERSION, type ContractError } from '@crowd-control/contract';
import { Pool } from 'pg';
import { createAuth0TokenVerifier } from './auth.ts';
import { getOwnedRuns, getRunAnalytics, getSafetyReportEvidence, initializeDatabase, saveIntervention, saveMetricBatch, saveRun } from './database.ts';
import { createGeminiPlanner } from './planner.ts';
import { createGeminiSafetyReporter } from './safetyReport.ts';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const MAX_PLANNER_BODY_BYTES = 64 * 1024;
const verifyAccessToken = createAuth0TokenVerifier(
  process.env.AUTH0_DOMAIN,
  process.env.AUTH0_AUDIENCE,
);
const plan = createGeminiPlanner({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
});
const generateSafetyReport = createGeminiSafetyReporter({
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

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; error: ContractError }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > MAX_PLANNER_BODY_BYTES) {
      return { ok: false, error: { code: 'RESOURCE_LIMIT', message: 'Planner request exceeds the 64 KiB limit.' } };
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

  const reportRoute = /^\/api\/runs\/([^/]+)\/report$/.exec(telemetryPath);
  if (request.method === 'POST' && reportRoute) {
    void (async () => {
      if (!database || !await databaseReady) {
        sendJson(response, 503, { ok: false, error: 'Tiger Data is not available.' });
        return;
      }
      const evidence = await getSafetyReportEvidence(database, ownerSub, reportRoute[1]!);
      if (evidence === 'invalid') {
        sendJson(response, 400, { ok: false, error: 'Run ID must be a UUID.' });
        return;
      }
      if (evidence === null) {
        sendJson(response, 404, { ok: false, error: 'Run was not found.' });
        return;
      }
      const result = await generateSafetyReport({ runId: reportRoute[1]!, ...evidence });
      if (!result.ok) {
        sendJson(response, result.status, { ok: false, error: result.error });
        return;
      }
      sendJson(response, 200, { ok: true, report: result.report });
    })().catch((error: unknown) => {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
      console.error(`Safety report generation failed (${code}).`);
      sendJson(response, 503, { ok: false, error: 'Could not generate the safety report.' });
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

server.listen(port, '127.0.0.1', () => {
  console.log('Crowd Control API: http://127.0.0.1:' + port);
});
