let touchStart = null;

document.addEventListener("touchstart", (event) => {
    touchStart = event.touches.length === 1 && document.scrollingElement.scrollTop <= 0
        ? event.touches[0]
        : null;
}, { passive: true });

// Safari can still refresh at the top even with overscroll-behavior set.
document.addEventListener("touchmove", (event) => {
    if (!touchStart || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const horizontal = touch.clientX - touchStart.clientX;
    const vertical = touch.clientY - touchStart.clientY;
    if (horizontal === 0 && vertical === 0) return;

    if (vertical > Math.abs(horizontal) && document.scrollingElement.scrollTop <= 0 && event.cancelable) {
        event.preventDefault();
    } else {
        touchStart = null;
    }
}, { passive: false });
