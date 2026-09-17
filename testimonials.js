(() => {
    const section = document.querySelector('.testimonials-showcase');
    if (!section) return;

    const slider = section.querySelector('.testimonial-rating');
    const stars = [...slider.querySelectorAll('[data-star]')];
    const quotes = [...section.querySelectorAll('.testimonial-quote')];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let rating = 5;
    let gesture;
    let tappedStar;
    let suppressClick = false;
    let activeQuote = 0;
    let visible = false;
    let timer;

    function setRating(value) {
        rating = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
        slider.dataset.rating = String(rating);
        slider.setAttribute('aria-valuenow', String(rating));
        slider.setAttribute('aria-valuetext', `${rating} out of 5 stars`);
        stars.forEach((star, index) => {
            star.dataset.fill = rating >= index + 1 ? 'full' : rating >= index + 0.5 ? 'half' : 'empty';
        });
    }

    function ratingAt(clientX) {
        const left = stars[0].getBoundingClientRect().left;
        const right = stars[stars.length - 1].getBoundingClientRect().right;
        return right > left ? ((clientX - left) / (right - left)) * 5 : rating;
    }

    slider.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        gesture = { id: event.pointerId, x: event.clientX, dragging: false, rating };
        // Pointer capture retargets the eventual click to the pill, not the star.
        tappedStar = event.target.closest('[data-star]');
        suppressClick = false;
        slider.setPointerCapture(event.pointerId);
    });
    slider.addEventListener('pointermove', (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        if (Math.abs(event.clientX - gesture.x) > 4) gesture.dragging = true;
        if (gesture.dragging) setRating(ratingAt(event.clientX));
    });
    slider.addEventListener('pointerup', (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        suppressClick = gesture.dragging;
        if (gesture.dragging) setRating(ratingAt(event.clientX));
        gesture = undefined;
        slider.releasePointerCapture(event.pointerId);
    });
    slider.addEventListener('pointercancel', () => {
        if (gesture) setRating(gesture.rating);
        gesture = undefined;
        tappedStar = undefined;
        suppressClick = false;
    });
    slider.addEventListener('lostpointercapture', () => { gesture = undefined; });
    slider.addEventListener('click', (event) => {
        if (suppressClick) {
            suppressClick = false;
            tappedStar = undefined;
            return;
        }
        const star = tappedStar || event.target.closest('[data-star]');
        tappedStar = undefined;
        if (star) {
            const fullValue = Number(star.dataset.star);
            setRating(rating === fullValue ? fullValue - 0.5 : fullValue);
        } else {
            setRating(ratingAt(event.clientX));
        }
    });
    slider.addEventListener('keydown', (event) => {
        const steps = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5, PageUp: 1, PageDown: -1 };
        if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        setRating(event.key === 'Home' ? 0 : event.key === 'End' ? 5 : rating + steps[event.key]);
    });

    function scheduleQuote() {
        clearTimeout(timer);
        if (reducedMotion.matches || !visible || document.hidden || document.body.classList.contains('search-active') || quotes.length < 2) return;
        timer = setTimeout(() => {
            quotes[activeQuote].removeAttribute('data-active');
            quotes[activeQuote].setAttribute('aria-hidden', 'true');
            activeQuote = (activeQuote + 1) % quotes.length;
            quotes[activeQuote].dataset.active = 'true';
            quotes[activeQuote].removeAttribute('aria-hidden');
            scheduleQuote();
        }, 2000);
    }

    reducedMotion.addEventListener('change', scheduleQuote);
    document.addEventListener('visibilitychange', scheduleQuote);
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; scheduleQuote(); }).observe(section);
    new MutationObserver(scheduleQuote).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setRating(5);
    scheduleQuote();
})();
