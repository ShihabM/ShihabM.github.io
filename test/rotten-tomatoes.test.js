import assert from "node:assert/strict";
import test from "node:test";
import { parseRottenTomatoesScores, rottenTomatoesURLs, fetchRottenTomatoesScores } from "../worker/rotten-tomatoes.js";
import { createUpstreamURL, handleRequest } from "../worker/index.js";

const movie = { id: 872585, title: "Oppenheimer", release_date: "2023-07-21" };
const show = { id: 95396, name: "Severance", first_air_date: "2022-02-18" };
const environment = { TMDB_API_KEY: "fixture-key", TMDB_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const scorecard = (critics = "93", audience = "91", certified = true) =>
    `<script type="application/json" data-json="mediaScorecard">${JSON.stringify({
        criticsScore: { score: critics, certified }, audienceScore: { scorePercent: `${audience}%` }
    })}</script>`;

test("reads current movie/season scorecards, preserving zero and rejecting invalid percentages", () => {
    assert.deepEqual(parseRottenTomatoesScores(scorecard()), { critics: "93%", audience: "91%", criticsCertified: true });
    assert.deepEqual(parseRottenTomatoesScores(scorecard("94", "74")), { critics: "94%", audience: "74%", criticsCertified: true });
    assert.deepEqual(parseRottenTomatoesScores(scorecard(0, "101", false)), { critics: "0%", audience: "", criticsCertified: false });
});

test("falls back to visible or legacy scorecards without taking recommendation scores", () => {
    const html = `<script data-json='mediaScorecard'>invalid json</script><media-scorecard>
        <score-icon-critics certified="true"></score-icon-critics>
        <rt-text slot="critics-score" role="button">93%</rt-text>
        <rt-text role="button" slot='audience-score'>91%</rt-text>
        </media-scorecard>`;
    assert.deepEqual(parseRottenTomatoesScores(html), { critics: "93%", audience: "91%", criticsCertified: true });
    assert.deepEqual(parseRottenTomatoesScores('<score-board tomatometerscore="40" audiencescore="0">'),
        { critics: "40%", audience: "0%", criticsCertified: false });
    const unrelated = '<script data-json="recommendations">{"criticsScore":{"score":"99"}}</script>Tomatometer 99% Popcornmeter 98%';
    assert.deepEqual(parseRottenTomatoesScores(unrelated), { critics: "", audience: "", criticsCertified: false });
});

test("constructs bounded Rotten Tomatoes movie and selected-season URLs", () => {
    assert.deepEqual(rottenTomatoesURLs(movie, "movie", null), [
        "https://www.rottentomatoes.com/m/oppenheimer_2023",
        "https://www.rottentomatoes.com/m/oppenheimer_2022",
        "https://www.rottentomatoes.com/m/oppenheimer"
    ]);
    const urls = rottenTomatoesURLs(show, "tv", 2);
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.endsWith('/s02')));
    assert.ok(rottenTomatoesURLs({ title: "../../https://evil.example/" }, "movie", null)
        .every(url => new URL(url).origin === 'https://www.rottentomatoes.com'));
});

test("ratings routes only accept TMDB IDs and TV season parameters", () => {
    const movieTarget = createUpstreamURL(new URL('https://binge.movie/api/tmdb/movie/872585/ratings'), environment.TMDB_API_KEY);
    assert.equal(movieTarget.url.pathname, '/3/movie/872585');
    assert.deepEqual(movieTarget.ratings, { kind: 'movie', season: null });
    const tvTarget = createUpstreamURL(new URL('https://binge.movie/api/tmdb/tv/95396/ratings?season=2'), environment.TMDB_API_KEY);
    assert.deepEqual(tvTarget.ratings, { kind: 'tv', season: 2 });
    for (const path of [
        '/movie/1/ratings?url=https://evil.example', '/movie/1/ratings?season=2',
        '/tv/1/ratings', '/tv/1/ratings?season=-1', '/tv/1/ratings?season=2&season=3',
        '/tv/1/ratings?season=2&url=https://evil.example', '/movie/nope/ratings'
    ]) {
        assert.ok(createUpstreamURL(new URL(`https://binge.movie/api/tmdb${path}`), environment.TMDB_API_KEY).status >= 400);
    }
});

test("the Worker loads scores directly with CORS headers and no credential in the RT request", async () => {
    const response = await handleRequest(new Request('https://binge.movie/api/tmdb/movie/872585/ratings', {
        headers: { origin: 'https://binge.movie' }
    }), environment, async (url, options) => {
        assert.equal(options.redirect, 'manual');
        if (url.origin === 'https://api.themoviedb.org') return Response.json(movie);
        assert.equal(url.origin, 'https://www.rottentomatoes.com');
        assert.equal(url.href.includes(environment.TMDB_API_KEY), false);
        return new Response(scorecard());
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://binge.movie');
    assert.deepEqual(await response.json(), { critics: '93%', audience: '91%', criticsCertified: true });
});

test("TV season ratings use separate caches and cached reads still enforce rate limits", async () => {
    const cached = new Map();
    let fetches = 0;
    let rateChecks = 0;
    const cache = {
        match: async request => cached.get(request.url)?.clone(),
        put: async (request, response) => {
            assert.equal(response.headers.has('access-control-allow-origin'), false);
            cached.set(request.url, response);
        }
    };
    const fetcher = async url => {
        fetches++;
        if (url.origin === 'https://api.themoviedb.org') return Response.json(show);
        return new Response(scorecard(url.pathname.endsWith('s01') ? '97' : '94', '74'));
    };
    const env = { ...environment, TMDB_RATE_LIMITER: { limit: async () => ({ success: ++rateChecks <= 3 }) } };
    for (const [season, expected] of [[1, '97%'], [2, '94%'], [1, '97%']]) {
        const response = await handleRequest(new Request(`https://binge.movie/api/tmdb/tv/95396/ratings?season=${season}`), env, fetcher, { cache });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).critics, expected);
    }
    assert.equal(cached.size, 2);
    assert.equal(fetches, 6); // One TMDB request and two URL candidates for each season.
    assert.equal((await handleRequest(new Request('https://binge.movie/api/tmdb/tv/95396/ratings?season=1'), env, fetcher, { cache })).status, 429);
});

test("unavailable upstream scores remain retryable and are never cached as empty ratings", async () => {
    const response = await handleRequest(new Request('https://binge.movie/api/tmdb/movie/872585/ratings'), environment,
        async url => url.origin === 'https://api.themoviedb.org' ? Response.json(movie) : new Response('no scores', { status: 503 }),
        { cache: { match: async () => undefined, put: () => assert.fail('failed ratings must not be cached') } });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test("same-origin redirects work; redirects to arbitrary hosts are rejected", async () => {
    const redirected = await fetchRottenTomatoesScores(movie, 'movie', null, async url =>
        url.pathname === '/m/canonical' ? new Response(scorecard()) :
            new Response(null, { status: 301, headers: { location: '/m/canonical' } }));
    assert.equal(redirected.critics, '93%');
    const requested = [];
    const rejected = await fetchRottenTomatoesScores(movie, 'movie', null, async url => {
        requested.push(url.origin);
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/m/film' } });
    });
    assert.deepEqual(rejected, {});
    assert.ok(requested.every(origin => origin === 'https://www.rottentomatoes.com'));
});

test("movie candidates cannot return scores from a different remake", async () => {
    const scores = await fetchRottenTomatoesScores(movie, 'movie', null, async () =>
        new Response(`<script type="application/ld+json">{"dateCreated":"1950-01-01"}</script>${scorecard()}`));
    assert.deepEqual(scores, {});
});
