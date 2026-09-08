(() => {
    const wall = document.querySelector('.widgets-wall');
    const group = wall?.querySelector('.widgets-group');
    const button = document.querySelector('.widgets-motion');
    if (!wall || !group || !button) return;

    const track = group.parentElement;
    const fillWall = () => {
        // Include a complete offscreen cycle even on very wide displays.
        const copies = Math.max(1, Math.ceil(wall.clientWidth / loopWidth));
        while (track.children.length < copies + 1) {
            const copy = group.cloneNode(true);
            copy.setAttribute('aria-hidden', 'true');
            copy.querySelectorAll('img').forEach(image => { image.alt = ''; });
            track.append(copy);
        }
        while (track.children.length > copies + 1) track.lastElementChild.remove();
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let userPaused = null;
    let interacting = false;
    let touching = false;
    let resumeTimer;
    let visible = false;
    let lastTime = 0;
    let frame = 0;
    let position = wall.scrollLeft;
    let loopWidth = group.getBoundingClientRect().width;

    const isPaused = () => userPaused ?? reducedMotion.matches;
    const canAnimate = () => !isPaused() && !interacting && visible && !document.hidden;
    const updateButton = () => {
        button.textContent = isPaused() ? 'Resume animation' : 'Pause animation';
    };
    const tick = time => {
        frame = 0;
        if (!canAnimate()) return;
        if (lastTime && loopWidth > 0) {
            // Keep subpixel progress so slow motion stays smooth on every display.
            position = (position + Math.min(time - lastTime, 64) * 0.018) % loopWidth;
            wall.scrollLeft = position;
        }
        lastTime = time;
        frame = requestAnimationFrame(tick);
    };
    const sync = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
        position = wall.scrollLeft;
        if (canAnimate()) frame = requestAnimationFrame(tick);
    };
    const scheduleResume = () => {
        clearTimeout(resumeTimer);
        if (touching) return;
        resumeTimer = setTimeout(() => {
            interacting = false;
            sync();
        }, 1800);
    };
    const browse = () => {
        interacting = true;
        sync();
        scheduleResume();
    };

    button.hidden = false;
    updateButton();
    button.addEventListener('click', () => {
        userPaused = !isPaused();
        interacting = false;
        clearTimeout(resumeTimer);
        updateButton();
        sync();
    });
    wall.addEventListener('pointerdown', () => { touching = true; browse(); }, { passive: true });
    const endTouch = () => {
        if (!touching) return;
        touching = false;
        scheduleResume();
    };
    window.addEventListener('pointerup', endTouch, { passive: true });
    window.addEventListener('pointercancel', endTouch, { passive: true });
    wall.addEventListener('wheel', event => {
        if (Math.abs(event.deltaX) > 0 || event.shiftKey) browse();
    }, { passive: true });
    wall.addEventListener('focus', browse);
    wall.addEventListener('keydown', event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) browse();
    });
    wall.addEventListener('scroll', () => {
        // Allow touch momentum to finish before restarting automatic movement.
        if (interacting) scheduleResume();
    }, { passive: true });
    reducedMotion.addEventListener('change', () => {
        updateButton();
        sync();
    });
    document.addEventListener('visibilitychange', sync);
    const resizeObserver = new ResizeObserver(() => {
        loopWidth = group.getBoundingClientRect().width;
        if (loopWidth > 0) fillWall();
        sync();
    });
    resizeObserver.observe(group);
    resizeObserver.observe(wall);
    new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        sync();
    }).observe(wall);
})();
