import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../search.js', import.meta.url), 'utf8');
const movie = { id: 872585, title: 'Oppenheimer', imdb_id: 'tt15398776' };

function setup() {
    const helpers = {};
    const requests = [];
    const timers = new Map();
    let sequence = 0;
    const node = { addEventListener() {}, querySelector: () => node };
    const document = { title: 'Binge', querySelector: selector => selector.startsWith('#') ? node : null,
        querySelectorAll: () => [], addEventListener() {} };
    const window = { location: { href: 'https://binge.movie/', origin: 'https://binge.movie' },
        matchMedia: () => ({ matches: false }), addEventListener() {},
        setTimeout(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; },
        clearTimeout(id) { timers.delete(id); } };
    const fetch = (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        requests.push({ url: new URL(url), signal, reject,
            respond: data => resolve({ ok: true, json: async () => data }) });
    });
    // Expose the ratings loader only in the VM; production code remains enclosed.
    runInNewContext(source.replace('const initialMediaRoute = mediaRouteFromLocation();',
        'ratingHelpers.fetch = fetchExternalRatingMetrics; const initialMediaRoute = mediaRouteFromLocation();'),
    { document, window, fetch, URL, AbortController, DOMException, ratingHelpers: helpers });
    const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
    return { helpers, requests, timers, flush };
}

test('Rotten Tomatoes scores publish while other providers are still pending', async () => {
    const s = setup();
    const updates = [];
    let finished = false;
    const complete = s.helpers.fetch(movie, 'movie', null, metrics => updates.push(metrics));
    void complete.then(() => { finished = true; });
    assert.equal(s.requests[0].url.pathname, '/api/tmdb/movie/872585/ratings');
    assert.equal(s.requests.some(request => request.url.hostname === 'proxy.cors.sh'), false);
    s.requests[0].respond({ critics: '93%', audience: '91%', criticsCertified: true });
    await s.flush();
    assert.equal(finished, false);
    assert.equal(updates[0][0].value, '93%');
    assert.equal(updates[0][1].value, '91%');
    assert.match(updates[0][0].icon, /rt-certified/);
    s.requests[1].respond({ meta: { imdbRating: 8.3 } });
    s.requests[2].reject(new Error('Wikidata unavailable'));
    const metrics = await complete;
    assert.equal(metrics.find(metric => metric.label === 'IMDb').value, '8.3 /10');
    assert.equal(metrics.find(metric => metric.label === 'Critics').value, '93%');
});

test('optional rating providers time out and completed scores remain reusable', async () => {
    const s = setup();
    const complete = s.helpers.fetch(movie, 'movie', null);
    s.requests[0].respond({ critics: '93%', audience: '91%' });
    await s.flush();
    for (const timer of [...s.timers.values()]) if (timer.delay === 7000) timer.fn();
    const metrics = await complete;
    assert.equal(s.requests[1].signal.aborted, true);
    assert.equal(s.requests[2].signal.aborted, true);
    assert.equal(s.timers.size, 0);
    const cachedUpdates = [];
    assert.equal(await s.helpers.fetch(movie, 'movie', null, update => cachedUpdates.push(update)), metrics);
    assert.equal(s.requests.length, 3);
    assert.equal(cachedUpdates[0][0].value, '93%');
});

test('failed scores are retried and movie fallback ratings cannot be applied to a TV season', async () => {
    const s = setup();
    const show = { id: 95396, imdb_id: 'tt11280740' };
    const complete = s.helpers.fetch(show, 'tv', 2);
    assert.equal(s.requests[0].url.searchParams.get('season'), '2');
    s.requests[0].reject(new Error('RT unavailable'));
    s.requests[1].respond({ meta: {} });
    s.requests[2].respond({ results: { bindings: [{
        reviewer: { value: 'https://www.wikidata.org/entity/Q105584' },
        method: { value: 'https://www.wikidata.org/entity/Q108403393' }, score: { value: '99%' }
    }] } });
    assert.equal((await complete).find(metric => metric.label === 'Critics').value, '—');
    const retried = s.helpers.fetch(show, 'tv', 2);
    assert.equal(s.requests.length, 6);
    s.requests[3].respond({ critics: '94%', audience: '74%' });
    s.requests[4].respond({ meta: {} });
    s.requests[5].respond({ results: { bindings: [] } });
    assert.equal((await retried).find(metric => metric.label === 'Critics').value, '94%');
});
