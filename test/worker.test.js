import assert from "node:assert/strict";
import test from "node:test";

import { createUpstreamURL, handleRequest } from "../worker/index.js";

const secret = "test-server-only-key";
const environment = {
    TMDB_API_KEY: secret,
    TMDB_RATE_LIMITER: { limit: async () => ({ success: true }) }
};

test("builds an allowlisted search request with server-owned parameters", () => {
    const result = createUpstreamURL(
        new URL("https://binge.movie/api/tmdb/search/movie?query=Alien"),
        secret
    );

    assert.equal(result.url.origin, "https://api.themoviedb.org");
    assert.equal(result.url.pathname, "/3/search/movie");
    assert.equal(result.url.searchParams.get("query"), "Alien");
    assert.equal(result.url.searchParams.get("include_adult"), "false");
    assert.equal(result.url.searchParams.get("page"), "1");
    assert.equal(result.url.searchParams.get("api_key"), secret);
});

test("rejects extra query parameters and arbitrary TMDB paths", () => {
    const extra = createUpstreamURL(
        new URL("https://binge.movie/api/tmdb/search/movie?query=Alien&api_key=attacker"),
        secret
    );
    const arbitrary = createUpstreamURL(
        new URL("https://binge.movie/api/tmdb/account/1"),
        secret
    );
    const duplicate = createUpstreamURL(
        new URL("https://binge.movie/api/tmdb/search/movie?query=Alien&query=Aliens"),
        secret
    );

    assert.equal(extra.status, 400);
    assert.equal(arbitrary.status, 404);
    assert.equal(duplicate.status, 400);
});

test("uses the server secret without exposing it in the response", async () => {
    let requestedURL;
    let fetchOptions;
    const fetchImpl = async (url, options) => {
        requestedURL = url;
        fetchOptions = options;
        return new Response(JSON.stringify({ results: [] }), {
            headers: { "content-type": "application/json" }
        });
    };
    const response = await handleRequest(
        new Request("https://binge.movie/api/tmdb/search/tv?query=Severance"),
        environment,
        fetchImpl
    );

    assert.equal(response.status, 200);
    assert.equal(requestedURL.searchParams.get("api_key"), secret);
    assert.equal(fetchOptions.cache, "no-store");
    assert.equal((await response.text()).includes(secret), false);
});

test("enforces the configured rate limiter", async () => {
    const response = await handleRequest(
        new Request("https://binge.movie/api/tmdb/movie/11", {
            headers: { "cf-connecting-ip": "203.0.113.10" }
        }),
        {
            TMDB_API_KEY: secret,
            TMDB_RATE_LIMITER: { limit: async () => ({ success: false }) }
        },
        () => assert.fail("upstream fetch should not run")
    );

    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
});

test("rejects cross-origin browser requests", async () => {
    const response = await handleRequest(
        new Request("https://binge.movie/api/tmdb/movie/11", {
            headers: { origin: "https://malicious.example" }
        }),
        { TMDB_API_KEY: secret },
        () => assert.fail("upstream fetch should not run")
    );

    assert.equal(response.status, 403);
});

test("fails closed when the runtime secret is missing", async () => {
    const response = await handleRequest(
        new Request("https://binge.movie/api/tmdb/movie/11"),
        {},
        () => assert.fail("upstream fetch should not run")
    );

    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("api_key"), false);
});

test("fails closed when the rate limit binding is missing or unavailable", async () => {
    for (const env of [
        { TMDB_API_KEY: secret },
        { TMDB_API_KEY: secret, TMDB_RATE_LIMITER: { limit: async () => { throw new Error("Unavailable"); } } }
    ]) {
        const response = await handleRequest(
            new Request("https://binge.movie/api/tmdb/movie/11"), env,
            () => assert.fail("upstream fetch should not run")
        );
        assert.ok(response.status >= 500);
        assert.equal(response.headers.get("cache-control"), "no-store");
    }
});

test("does not forward upstream errors or redirects containing credentials", async () => {
    for (const status of [301, 401, 429, 500]) {
        const response = await handleRequest(
            new Request("https://binge.movie/api/tmdb/movie/11"), environment,
            async (_url, options) => {
                assert.equal(options.redirect, "manual");
                return new Response(secret, { status, headers: { location: `https://example.com/${secret}` } });
            }
        );
        assert.equal(response.status, 502);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.has("location"), false);
        assert.equal((await response.text()).includes(secret), false);
    }
});

test("cache keys exclude credentials and cache hits still pass rate limiting", async () => {
    let cached;
    let rateChecks = 0;
    let fetches = 0;
    const cache = {
        match: async (request) => {
            assert.equal(request.url.includes(secret), false);
            assert.equal(request.url.includes("api_key"), false);
            return cached?.clone();
        },
        put: async (request, response) => {
            assert.equal(request.url.includes(secret), false);
            assert.equal(response.headers.has("access-control-allow-origin"), false);
            cached = response;
        }
    };
    const env = {
        TMDB_API_KEY: secret,
        TMDB_RATE_LIMITER: { limit: async () => ({ success: ++rateChecks <= 2 }) }
    };
    const fetcher = async () => { fetches++; return Response.json({ id: 11 }); };
    const request = new Request("https://binge-movie.shihabm.workers.dev/api/tmdb/movie/11", {
        headers: { origin: "https://binge.movie" }
    });
    for (let i = 0; i < 2; i++) {
        const response = await handleRequest(request, env, fetcher, { cache });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://binge.movie");
    }
    assert.equal((await handleRequest(request, env, fetcher, { cache })).status, 429);
    assert.equal(fetches, 1);
});
