import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../testimonials.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const titles = [...html.matchAll(/<blockquote class="testimonial-quote"[^>]*>(.*?)<\/blockquote>/g)].map(match => match[1]);

function setup(reduced = false) {
    function surface(props = {}) {
        const events = {};
        const attributes = {};
        return { dataset: {}, ...props,
            addEventListener(type, fn) { events[type] = fn; },
            emit(type, event = {}) { events[type]?.(event); },
            setAttribute(name, value) { attributes[name] = value; },
            getAttribute(name) { return attributes[name]; },
            removeAttribute(name) { delete attributes[name]; if (name === 'data-active') delete this.dataset.active; }
        };
    }
    const stars = Array.from({ length: 5 }, (_, index) => {
        const star = surface({ dataset: { star: String(index + 1) },
            getBoundingClientRect: () => ({ left: 18 + index * 36, right: 42 + index * 36 }) });
        star.closest = () => star;
        return star;
    });
    const slider = surface({ querySelectorAll: () => stars, setPointerCapture() {}, releasePointerCapture() {}, closest: () => null });
    const quotes = titles.map(textContent => surface({ textContent }));
    quotes[0].dataset.active = 'true';
    const section = { querySelector: s => s === '.testimonial-rating' ? slider : null, querySelectorAll: () => quotes };
    const media = surface({ matches: reduced });
    const body = { search: false, classList: { contains: () => body.search } };
    const document = surface({ hidden: false, body, querySelector: () => section });
    let sequence = 0, visibility, mutation;
    const timers = new Map();
    runInNewContext(source, {
        document, window: { matchMedia: () => media },
        setTimeout(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; },
        clearTimeout(id) { timers.delete(id); },
        IntersectionObserver: class { constructor(fn) { visibility = fn; } observe() { visibility([{ isIntersecting: true }]); } },
        MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} }
    });
    const pointer = (x, extra = {}) => ({ clientX: x, pointerId: 1, button: 0, isPrimary: true, target: slider, ...extra });
    return { slider, stars, quotes, document, media, timers,
        rating: () => Number(slider.getAttribute('aria-valuenow')),
        key(key) { let prevented = false; slider.emit('keydown', { key, preventDefault() { prevented = true; } }); return prevented; },
        tap(index) {
            const event = pointer(30 + index * 36, { target: stars[index] });
            slider.emit('pointerdown', event);
            slider.emit('pointerup', event);
            // Browsers retarget captured clicks to the slider.
            slider.emit('click', pointer(event.clientX));
        },
        drag(start, end, cancel = false) {
            slider.emit('pointerdown', pointer(start));
            slider.emit('pointermove', pointer(end));
            slider.emit(cancel ? 'pointercancel' : 'pointerup', pointer(end));
            if (!cancel) slider.emit('click', pointer(end));
        },
        tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(({ fn }) => fn()); },
        setVisible(value) { visibility([{ isIntersecting: value }]); },
        search(value) { body.search = value; mutation(); }
    };
}

test('rating starts at five stars and tapping mirrors the iPhone full/half toggle', () => {
    const s = setup();
    assert.equal(s.rating(), 5);
    assert.equal(s.slider.dataset.rating, '5');
    assert.ok(s.stars.every(star => star.dataset.fill === 'full'));
    s.tap(4);
    assert.equal(s.rating(), 4.5);
    assert.equal(s.stars[4].dataset.fill, 'half');
    s.tap(4);
    assert.equal(s.rating(), 5);
    s.tap(2);
    assert.equal(s.rating(), 3);
    s.tap(2);
    assert.equal(s.rating(), 2.5);
    assert.deepEqual(s.stars.map(star => star.dataset.fill), ['full', 'full', 'half', 'empty', 'empty']);
    assert.equal(s.slider.getAttribute('aria-valuetext'), '2.5 out of 5 stars');
});

test('dragging uses half-star steps, clamps both ends, and suppresses the following click', () => {
    const s = setup();
    s.drag(186, 102);
    assert.equal(s.rating(), 2.5);
    s.drag(102, -40);
    assert.equal(s.rating(), 0);
    s.drag(18, 260);
    assert.equal(s.rating(), 5);
    s.drag(186, 68);
    assert.equal(s.rating(), 1.5);
    s.drag(68, 150, true);
    assert.equal(s.rating(), 1.5);
    s.tap(4);
    assert.equal(s.rating(), 5);
});

test('slider supports keyboard half-star steps and accessible endpoints', () => {
    const s = setup();
    assert.equal(s.key('ArrowLeft'), true);
    assert.equal(s.rating(), 4.5);
    s.key('ArrowDown');
    assert.equal(s.rating(), 4);
    s.key('ArrowUp');
    s.key('ArrowRight');
    assert.equal(s.rating(), 5);
    s.key('Home');
    assert.equal(s.rating(), 0);
    s.key('ArrowLeft');
    assert.equal(s.rating(), 0);
    s.key('PageUp');
    assert.equal(s.rating(), 1);
    s.key('End');
    assert.equal(s.rating(), 5);
    assert.equal(s.key('Tab'), false);
});

test('all 19 testimonials cycle in order every three seconds and loop', () => {
    const s = setup();
    assert.equal(titles.length, 19);
    assert.equal(titles[0], 'BEST APP EVER');
    assert.equal(titles.at(-1), 'Really good app!');
    for (let index = 0; index < 38; index++) {
        assert.equal(s.quotes.filter(quote => quote.dataset.active === 'true').length, 1);
        assert.equal(s.quotes[index % 19].dataset.active, 'true');
        assert.equal([...s.timers.values()][0].delay, 3000);
        s.tick();
    }
    assert.equal(s.quotes[0].dataset.active, 'true');
    assert.equal(s.quotes[1].getAttribute('aria-hidden'), 'true');
});

test('rotation stops offscreen, in a hidden tab, and while search is open', () => {
    const s = setup();
    s.setVisible(false);
    assert.equal(s.timers.size, 0);
    s.setVisible(true);
    assert.equal(s.timers.size, 1);
    s.document.hidden = true;
    s.document.emit('visibilitychange');
    assert.equal(s.timers.size, 0);
    s.document.hidden = false;
    s.document.emit('visibilitychange');
    assert.equal(s.timers.size, 1);
    s.search(true);
    assert.equal(s.timers.size, 0);
    s.search(false);
    assert.equal(s.timers.size, 1);
});

test('testimonials have no pause button and continue to respect reduced motion', () => {
    assert.doesNotMatch(html, /testimonials-motion|Pause testimonials/);
    const reduced = setup(true);
    assert.equal(reduced.timers.size, 0);
    reduced.setVisible(false);
    reduced.setVisible(true);
    assert.equal(reduced.timers.size, 0);
    reduced.media.matches = false;
    reduced.media.emit('change');
    assert.equal(reduced.timers.size, 1);
    reduced.media.matches = true;
    reduced.media.emit('change');
    assert.equal(reduced.timers.size, 0);
});
