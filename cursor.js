(() => {
    const pointerQuery = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const interactiveSelector = [
        "a[href]",
        "button:not(:disabled)",
        "input[type='button']:not(:disabled)",
        "input[type='submit']:not(:disabled)",
        "input[type='reset']:not(:disabled)",
        "select:not(:disabled)",
        "summary",
        "label[for]",
        "[role='button']:not([aria-disabled='true'])",
        "[onclick]:not([aria-disabled='true'])"
    ].join(",");

    const layers = new Map();
    let activeLayer = null;

    const createLayer = (host) => {
        const layer = document.createElement("div");
        layer.className = "site-hand-cursor";
        layer.setAttribute("aria-hidden", "true");
        host.append(layer);
        layers.set(host, layer);
        return layer;
    };

    const getLayer = (target) => {
        const dialog = target.closest("dialog");
        if (dialog) return layers.get(dialog) || createLayer(dialog);
        return layers.get(document.body) || createLayer(document.body);
    };

    const hideCursor = () => {
        if (!activeLayer) return;
        activeLayer.classList.remove("is-visible");
        activeLayer = null;
    };

    const updateCursor = (event) => {
        if (event.pointerType && event.pointerType !== "mouse") {
            hideCursor();
            return;
        }

        const target = event.target instanceof Element
            ? event.target.closest(interactiveSelector)
            : null;

        if (!target) {
            hideCursor();
            return;
        }

        const layer = getLayer(target);
        if (activeLayer && activeLayer !== layer) activeLayer.classList.remove("is-visible");

        layer.style.transform = `translate3d(${event.clientX - 12}px, ${event.clientY - 8}px, 0)`;
        layer.classList.add("is-visible");
        activeLayer = layer;
    };

    const enableCursor = () => {
        if (!pointerQuery.matches || document.documentElement.classList.contains("site-hand-cursor-ready")) return;

        createLayer(document.body);
        document.querySelectorAll("dialog").forEach(createLayer);
        document.documentElement.classList.add("site-hand-cursor-ready");

        document.addEventListener("pointerover", updateCursor, { capture: true, passive: true });
        document.addEventListener("pointermove", updateCursor, { capture: true, passive: true });
        document.addEventListener("pointercancel", hideCursor, { capture: true, passive: true });
        document.documentElement.addEventListener("mouseleave", hideCursor, { passive: true });
        window.addEventListener("blur", hideCursor, { passive: true });
    };

    enableCursor();
})();
