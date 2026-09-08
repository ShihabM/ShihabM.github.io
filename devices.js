const carousel = document.querySelector('.device-carousel');

if (carousel) {
    const track = carousel.querySelector('.device-track');
    const slides = [...track.children];
    const dots = [...carousel.querySelectorAll('[data-slide]')];
    const status = carousel.querySelector('#device-status');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let active = 0;
    let target = 0;
    let scrollTimer;

    function goTo(index) {
        target = (index + slides.length) % slides.length;
        const offset = slides[target].getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
        track.scrollTo({ left: offset, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    }

    function update() {
        const left = track.getBoundingClientRect().left;
        active = slides.reduce((closest, slide, index) =>
            Math.abs(slide.getBoundingClientRect().left - left) < Math.abs(slides[closest].getBoundingClientRect().left - left) ? index : closest, 0);
        target = active;
        dots.forEach((dot, index) => {
            if (index === active) dot.setAttribute('aria-current', 'true');
            else dot.removeAttribute('aria-current');
        });
        status.textContent = `Slide ${active + 1} of ${slides.length}`;
    }

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
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(update, 120);
    }, { passive: true });
    track.addEventListener('scrollend', update);
}
