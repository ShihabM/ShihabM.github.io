const carousel = document.querySelector('.device-carousel');

if (carousel) {
    const section = carousel.closest('.devices-showcase');
    const track = carousel.querySelector('.device-track');
    const slides = [...track.children];
    const dots = [...carousel.querySelectorAll('[data-slide]')];
    const status = carousel.querySelector('#device-status');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = 0;
    let target = 0;
    let scrollTimer;
    let autoplayTimer;
    let paused = reducedMotion.matches;
    let hovered = false;
    let focused = false;
    let touching = false;
    let visible = false;

    function applyTheme(index) {
        if (section) section.dataset.activeDevice = String(index);
    }

    function scheduleAutoplay() {
        clearTimeout(autoplayTimer);
        const playing = !paused && !hovered && !focused && !touching && visible && !document.hidden;
        status.setAttribute('aria-live', playing ? 'off' : 'polite');
        if (playing) autoplayTimer = setTimeout(() => {
            goTo(target + 1);
        }, 2000);
    }

    function goTo(index) {
        target = (index + slides.length) % slides.length;
        applyTheme(target);
        const offset = slides[target].getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
        track.scrollTo({ left: offset, behavior: 'auto' });
        scheduleAutoplay();
    }

    function update() {
        const left = track.getBoundingClientRect().left;
        active = slides.reduce((closest, slide, index) =>
            Math.abs(slide.getBoundingClientRect().left - left) < Math.abs(slides[closest].getBoundingClientRect().left - left) ? index : closest, 0);
        target = active;
        applyTheme(active);
        dots.forEach((dot, index) => {
            if (index === active) dot.setAttribute('aria-current', 'true');
            else dot.removeAttribute('aria-current');
        });
        status.textContent = `Slide ${active + 1} of ${slides.length}`;
        scheduleAutoplay();
    }

    carousel.addEventListener('mouseenter', () => { hovered = true; scheduleAutoplay(); });
    carousel.addEventListener('mouseleave', () => { hovered = false; scheduleAutoplay(); });
    carousel.addEventListener('focusin', () => { focused = true; scheduleAutoplay(); });
    carousel.addEventListener('focusout', (event) => {
        focused = carousel.contains(event.relatedTarget);
        scheduleAutoplay();
    });
    track.addEventListener('pointerdown', () => { touching = true; scheduleAutoplay(); }, { passive: true });
    const endTouch = () => { touching = false; scheduleAutoplay(); };
    window.addEventListener('pointerup', endTouch, { passive: true });
    window.addEventListener('pointercancel', endTouch, { passive: true });
    document.addEventListener('visibilitychange', scheduleAutoplay);
    reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; scheduleAutoplay(); });
    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        scheduleAutoplay();
    }, { threshold: 0.25 }).observe(carousel);
    applyTheme(active);
    scheduleAutoplay();

    dots.forEach((dot) => dot.addEventListener('click', () => goTo(Number(dot.dataset.slide))));
    carousel.querySelectorAll('[data-direction]').forEach((button) => {
        button.addEventListener('click', () => goTo(target + Number(button.dataset.direction)));
    });
    track.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        goTo(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : target + (event.key === 'ArrowRight' ? 1 : -1));
    });
    track.addEventListener('scroll', () => {
        clearTimeout(autoplayTimer);
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(update, 120);
    }, { passive: true });
    track.addEventListener('scrollend', update);
}
