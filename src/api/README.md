# API modules

Group API code by domain. Keep request functions, query options, and React hooks together in a folder such as `api/auth/auth.ts`, `auth.query.ts`, and `auth.hooks.ts`. Add query and hook modules when the domain needs them. Put API request and response types in `api/$types/<domain>/request.ts` and `response.ts`. Shared transport setup belongs directly in `api/`.
