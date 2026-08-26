(() => {
    const root = document.documentElement;
    const overscrollClass = "is-bottom-overscrolling";
    let previousTouchY = 0;
    let clearTimer;

    const isAtBottom = () => {
        const scrollHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
        );

        return window.scrollY + window.innerHeight >= scrollHeight - 1;
    };

    const clearOverscroll = () => {
        root.classList.remove(overscrollClass);
    };

    const scheduleClear = () => {
        window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(clearOverscroll, 500);
    };

    window.addEventListener("touchstart", (event) => {
        window.clearTimeout(clearTimer);
        clearOverscroll();
        previousTouchY = event.touches[0]?.clientY ?? 0;
    }, { passive: true });

    window.addEventListener("touchmove", (event) => {
        const currentTouchY = event.touches[0]?.clientY ?? previousTouchY;
        const pullingPastBottom = currentTouchY < previousTouchY && isAtBottom();

        root.classList.toggle(overscrollClass, pullingPastBottom);
        previousTouchY = currentTouchY;
    }, { passive: true });

    window.addEventListener("touchend", scheduleClear, { passive: true });
    window.addEventListener("touchcancel", scheduleClear, { passive: true });
    window.addEventListener("pageshow", clearOverscroll);
})();
