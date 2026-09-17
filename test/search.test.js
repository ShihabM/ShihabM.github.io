import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../search.js', import.meta.url), 'utf8');

function setup() {
    class Node {
        constructor(fragment = false) {
            this.fragment = fragment;
            this.children = [];
            this.events = {};
            this.dataset = {};
            this.attributes = {};
            this.value = '';
            this.replacements = 0;
            this.style = { removeProperty() {} };
            const classes = new Set();
            this.classList = {
                add: value => classes.add(value),
                remove: value => classes.delete(value),
                contains: value => classes.has(value),
                toggle(value, enabled) {
                    const next = enabled ?? !classes.has(value);
                    if (next) classes.add(value); else classes.delete(value);
                    return next;
                }
            };
        }
        append(...nodes) {
            nodes.forEach(node => this.children.push(...(node.fragment ? node.children : [node])));
        }
        replaceChildren(...nodes) { this.replacements++; this.children = []; this.append(...nodes); }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(type, callback) { this.events[type] = callback; }
        emit(type, event = {}) { this.events[type]?.(event); }
        focus() {}
        blur() {}
    }
    const selectors = ['search-launch', 'search-experience', 'search-form', 'movie-search',
        'search-clear', 'search-exit', 'search-results-title', 'search-results', 'search-status',
        'media-dialog', 'media-dialog-content'];
    const nodes = Object.fromEntries(selectors.map(id => [id, new Node()]));
    const status = new Node();
    nodes['search-status'].querySelector = () => status;
    const filters = ['all', 'movie', 'tv'].map(filter => {
        const button = new Node();
        button.dataset.filter = filter;
        return button;
    });
    const document = new Node();
    document.body = new Node();
    document.title = 'Binge';
    document.querySelector = selector => nodes[selector.slice(1)] || null;
    document.querySelectorAll = () => filters;
    document.createElement = () => new Node();
    document.createDocumentFragment = () => new Node(true);
    const timers = new Map();
    let sequence = 0;
    let now = 0;
    const window = new Node();
    window.location = { href: 'http://localhost/', origin: 'http://localhost' };
    window.matchMedia = () => ({ matches: true });
    window.setTimeout = (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence; };
    window.clearTimeout = id => timers.delete(id);
    window.scrollTo = () => {};
    const requests = [];
    const fetch = (url, { signal }) => new Promise((resolve, reject) => {
        requests.push({ url, signal, reject, respond(results) {
            resolve({ ok: true, json: () => ({ results }) });
        } });
    });
    runInNewContext(source, { document, window, URL, AbortController, fetch,
        Date: class extends Date { static now() { return now; } } });
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const input = value => { nodes['movie-search'].value = value; nodes['movie-search'].emit('input'); };
    const fireTimer = () => {
        const queued = [...timers.values()];
        timers.clear();
        queued.forEach(({ fn }) => fn());
    };
    const respond = async (movies = [], shows = [], offset = requests.length - 2) => {
        requests[offset].respond(movies);
        requests[offset + 1].respond(shows);
        await flush();
    };
    return { nodes, status, filters, timers, requests, input, fireTimer, respond, flush,
        results: nodes['search-results'], advanceTime: ms => { now += ms; },
        submit() { nodes['search-form'].emit('submit', { preventDefault() {} }); } };
}

const movie = { id: 1, title: 'Dune', popularity: 20, poster_path: '/dune.jpg' };
const show = { id: 2, name: 'Dune show', popularity: 10 };

test('typing does no grid work until the debounce and loading cards are created only once', async () => {
    const s = setup();
    for (const query of ['d', 'du', 'dun', 'dune']) s.input(query);
    assert.equal(s.results.replacements, 0);
    assert.equal(s.requests.length, 0);
    assert.equal(s.timers.size, 1);
    assert.equal([...s.timers.values()][0].delay, 220);
    s.fireTimer();
    const skeletons = [...s.results.children];
    assert.equal(skeletons.length, 18);
    assert.equal(s.results.replacements, 1);
    s.input('dune part');
    assert.equal(s.requests[0].signal.aborted, true);
    s.fireTimer();
    assert.deepEqual(s.results.children, skeletons);
    assert.equal(s.results.replacements, 1);
    await s.respond([movie], [show]);
    assert.equal(s.results.children.length, 2);
    assert.equal(s.results.attributes['aria-busy'], 'false');
});

test('posters stay mounted during typing and filters reuse the same cards', async () => {
    const s = setup();
    s.input('dune'); s.fireTimer(); await s.respond([movie], [show]);
    const cards = [...s.results.children];
    const replacements = s.results.replacements;
    s.filters[1].emit('click');
    assert.equal(cards[0].hidden, false);
    assert.equal(cards[1].hidden, true);
    s.filters[2].emit('click');
    assert.equal(cards[0].hidden, true);
    assert.equal(cards[1].hidden, false);
    s.input('alien'); s.fireTimer();
    assert.deepEqual(s.results.children, cards);
    assert.equal(s.results.replacements, replacements);
    assert.match(cards[0].children[0].src, /\/w342\//);
    assert.match(cards[0].children[0].srcset, /w185\/dune.jpg 185w/);
});

test('repeated queries return immediately from a bounded, expiring cache', async () => {
    const s = setup();
    s.input('dune'); s.fireTimer(); await s.respond([movie], []);
    s.input('alien'); s.fireTimer(); await s.respond([], [show]);
    const count = s.requests.length;
    s.input('dune');
    assert.equal(s.requests.length, count);
    assert.equal(s.timers.size, 0);
    assert.equal(s.results.children[0].title, 'Dune');
    s.advanceTime(120001);
    s.input('dune'); s.fireTimer();
    assert.equal(s.requests.length, count + 2);
    await s.respond([movie], []);
    for (let i = 0; i < 20; i++) {
        s.input(`query ${i}`); s.fireTimer(); await s.respond([movie], []);
    }
    s.input('dune'); s.fireTimer();
    assert.equal(s.requests.length, count + 44);
});

test('older responses and errors cannot replace newer search results', async () => {
    const s = setup();
    s.input('dune'); s.fireTimer();
    s.input('alien'); s.fireTimer();
    await s.respond([{ ...movie, title: 'Alien' }], []);
    const cards = [...s.results.children];
    s.requests[0].reject(new Error('old network failure'));
    s.requests[1].reject(new Error('old network failure'));
    await s.flush();
    assert.deepEqual(s.results.children, cards);
    assert.equal(cards[0].title, 'Alien');
    assert.equal(s.results.attributes['aria-busy'], 'false');
});

test('submit and whitespace changes reuse an in-flight query; clearing cancels it', async () => {
    const s = setup();
    s.input('dune'); s.fireTimer();
    s.submit(); s.input('dune ');
    assert.equal(s.requests.length, 2);
    assert.equal(s.requests[0].signal.aborted, false);
    s.input('');
    assert.equal(s.requests[0].signal.aborted, true);
    assert.equal(s.results.children.length, 0);
    assert.equal(s.results.attributes['aria-busy'], 'false');
    await s.respond([movie], [show]);
    assert.equal(s.results.children.length, 0);
    assert.equal(s.status.textContent, 'Search for a movie or show to see it here.');
});

test('partial responses stay retryable and failed searches clear retained posters', async () => {
    const s = setup();
    s.input('dune'); s.fireTimer();
    s.requests[0].respond([movie]); s.requests[1].reject(new Error('offline'));
    await s.flush();
    assert.equal(s.results.children.length, 1);
    s.input(''); s.input('dune'); s.fireTimer();
    assert.equal(s.requests.length, 4);
    await s.respond([movie], []);
    s.input('alien'); s.fireTimer();
    s.requests[4].reject(new Error('offline')); s.requests[5].reject(new Error('offline'));
    await s.flush();
    assert.equal(s.results.children.length, 0);
    assert.equal(s.results.attributes['aria-busy'], 'false');
    assert.match(s.status.textContent, /couldn’t reach TMDB/);
});
