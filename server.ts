/**
 * Fresnel — Zero-AI Open-Source Node.js & TypeScript Audit Server Entrypoint (server.ts)
 *
 * Compatible with:
 * - AI Studio preview container (`npm run dev -- --port 3000 --host 0.0.0.0`)
 * - Cloud Run Share/Deploy (`npm start` or `node server.ts` with Node 22 strip-types)
 * - Local development (`npm run dev` or `npm start`)
 */

import { startFresnelServer, resolvePortAndHost } from './server/index.js';

const { port, host } = resolvePortAndHost();
startFresnelServer(port, host);
