import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../widgets.js', import.meta.url), 'utf8');
function setup(reduced = false) {
    const surface = (props = {}) => {
        const events = {};
        return { ...props, addEventListener: (type, fn) => { events[type] = fn; },
            emit: (type, event = {}) => events[type]?.(event) };
    };
    const track = { children: [], append(copy) { this.children.push(copy); },
        get lastElementChild() { return this.children.at(-1); } };
    const group = { parentElement: track, getBoundingClientRect: () => ({ width: 2328 }),
        cloneNode: () => ({ setAttribute() {}, querySelectorAll: () => [], remove() { track.children.pop(); } }) };
    track.children.push(group);
    const wall = surface({ clientWidth: 3840, scrollLeft: 0, querySelector: () => group });
    const button = surface();
    const media = surface({ matches: reduced });
    const document = surface({ hidden: false, querySelector: s => s === '.widgets-wall' ? wall : button });
    const window = surface({ matchMedia: () => media });
    let sequence = 0, visibility;
    const frames = new Map(), timers = new Map();
    runInNewContext(source, {
        document, window,
        requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(fn) { timers.set(++sequence, fn); return sequence; },
        clearTimeout(id) { timers.delete(id); },
        ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
        IntersectionObserver: class { constructor(fn) { visibility = fn; } observe() { visibility([{ isIntersecting: true }]); } }
    });
    const finishBrowsing = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
    return { wall, button, media, document, window, frames, track, finishBrowsing,
        setVisible(value) { visibility([{ isIntersecting: value }]); },
        step(time) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time)); } };
}

test('widgets start by default and loop on wide displays', () => {
    const s = setup();
    assert.equal(s.frames.size, 1);
    assert.equal(s.track.children.length, 3);
    assert.equal(s.button.textContent, 'Pause animation');
    for (let time = 16; time < 140000; time += 16) s.step(time);
    assert.ok(s.wall.scrollLeft > 0 && s.wall.scrollLeft < 2328);
});

test('widgets resume after keyboard browsing, wheel scrolling, and touch momentum', () => {
    const s = setup();
    for (const [type, event] of [['focus', {}], ['keydown', { key: 'ArrowRight' }], ['wheel', { deltaX: 10 }]]) {
        s.wall.emit(type, event);
        assert.equal(s.frames.size, 0);
        s.finishBrowsing();
        assert.equal(s.frames.size, 1);
    }
    s.wall.emit('pointerdown');
    s.finishBrowsing();
    assert.equal(s.frames.size, 0);
    s.window.emit('pointerup');
    s.wall.emit('scroll');
    s.finishBrowsing();
    assert.equal(s.frames.size, 1);
});

test('explicit pause persists through browsing and visibility changes', () => {
    const s = setup();
    s.button.emit('click');
    s.wall.emit('focus');
    s.finishBrowsing();
    s.setVisible(false);
    s.setVisible(true);
    assert.equal(s.frames.size, 0);
    assert.equal(s.button.textContent, 'Resume animation');
    s.button.emit('click');
    assert.equal(s.frames.size, 1);
});

test('automatic scrolling resumes when the section and document become visible', () => {
    const s = setup();
    s.setVisible(false);
    assert.equal(s.frames.size, 0);
    s.setVisible(true);
    assert.equal(s.frames.size, 1);
    s.document.hidden = true;
    s.document.emit('visibilitychange');
    assert.equal(s.frames.size, 0);
    s.document.hidden = false;
    s.document.emit('visibilitychange');
    assert.equal(s.frames.size, 1);
});

test('reduced motion stays still by default but permits explicit playback', () => {
    const s = setup(true);
    s.wall.emit('focus');
    s.finishBrowsing();
    assert.equal(s.frames.size, 0);
    s.button.emit('click');
    assert.equal(s.frames.size, 1);
});
