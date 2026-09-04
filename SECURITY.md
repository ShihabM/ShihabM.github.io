# Security

## Runtime secrets

The current website does not include the TMDB credential in browser-delivered source. The edge Worker reads `TMDB_API_KEY` from an encrypted runtime secret and exposes only the allowlisted read endpoints under `/api/tmdb`.

The original key was publicly exposed before this change. It has deliberately not been rotated. Removing it from published code and Git history cannot invalidate copies that others may already have.

For local development, copy `.dev.vars.example` to `.dev.vars`. That file is ignored by Git.

For production, configure the secret without putting it on a command line or in a tracked file:

```sh
npx wrangler secret put TMDB_API_KEY
```

Then deploy the static site and Worker together:

```sh
npm run deploy
```

The marketing site remains on GitHub Pages at `https://binge.movie`. The `binge-api-base` meta tag points to `https://binge-movie.shihabm.workers.dev/api/tmdb`. Deploy and verify the Worker before pushing changes to the Pages branch. Its own domain also serves the same static site.

For a local development preview, temporarily set the meta tag to `/api/tmdb` before running `npm run dev`; do not commit that local change.

The Worker accepts only movie/show searches, movie/show details, and TV season details. It fixes TMDB parameters server-side, rejects arbitrary API paths, restricts browser origins, caches read responses, and applies the configured Cloudflare rate-limit binding.

The limit is 60 requests per minute per client IP and request class (search or details), per Cloudflare location. These counters are approximate, and shared IP addresses share the allowance. CORS is browser policy, not authentication: clients outside a browser can still call the public, rate-limited endpoints. Missing or failed rate-limit configuration fails closed. Upstream errors are not cached or returned verbatim.

## Secret scanning

Run `npm run check:secrets` before committing. GitHub Actions also scans every push and pull request, including repository history, with Gitleaks.
