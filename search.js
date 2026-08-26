(() => {
    "use strict";

    const TMDB_API_KEY = "***REMOVED***";
    const TMDB_API_BASE = "https://api.themoviedb.org/3";
    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const SEARCH_DELAY = 350;

    const launchButton = document.querySelector("#search-launch");
    const searchExperience = document.querySelector("#search-experience");
    const searchForm = document.querySelector("#search-form");
    const searchInput = document.querySelector("#movie-search");
    const clearButton = document.querySelector("#search-clear");
    const exitButton = document.querySelector("#search-exit");
    const resultsTitle = document.querySelector("#search-results-title");
    const resultsContainer = document.querySelector("#search-results");
    const statusContainer = document.querySelector("#search-status");
    const statusText = statusContainer?.querySelector("p");
    const filterButtons = [...document.querySelectorAll(".search-filter")];
    const mediaDialog = document.querySelector("#media-dialog");
    const dialogContent = document.querySelector("#media-dialog-content");

    if (!launchButton || !searchExperience || !searchForm || !searchInput ||
        !clearButton || !exitButton || !resultsTitle || !resultsContainer ||
        !statusContainer || !statusText || !mediaDialog || !dialogContent) {
        return;
    }

    let searchTimer;
    let searchRequest;
    let detailRequest;
    let allResults = [];
    let activeFilter = "all";
    let lastScrollPosition = 0;

    const escapeHTML = (value = "") => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const imageURL = (path, size = "w780") => {
        if (!path || !/^\/[A-Za-z0-9._-]+$/.test(path)) return "";
        return `${TMDB_IMAGE_BASE}/${size}${path}`;
    };

    const mediaTitle = (item) => item.title || item.name || "Untitled";
    const mediaDate = (item) => item.release_date || item.first_air_date || "";
    const mediaYear = (item) => mediaDate(item).slice(0, 4);

    const apiURL = (path, parameters = {}) => {
        const url = new URL(`${TMDB_API_BASE}${path}`);
        url.searchParams.set("api_key", TMDB_API_KEY);
        url.searchParams.set("language", "en-US");
        Object.entries(parameters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, value);
            }
        });
        return url;
    };

    const getJSON = async (url, signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
        return response.json();
    };

    const setStatus = (message, visible = true) => {
        statusText.textContent = message;
        statusContainer.hidden = !visible;
    };

    const updateInputState = () => {
        const hasValue = Boolean(searchInput.value);
        searchForm.classList.toggle("has-value", hasValue);
        clearButton.disabled = !hasValue;
    };

    const setFilter = (filter) => {
        activeFilter = filter;
        filterButtons.forEach((button) => {
            const isActive = button.dataset.filter === filter;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
        renderResults();
    };

    const renderSkeletons = () => {
        resultsContainer.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < 18; index += 1) {
            const skeleton = document.createElement("div");
            skeleton.className = "search-result-card is-skeleton";
            skeleton.setAttribute("aria-hidden", "true");
            fragment.append(skeleton);
        }
        resultsContainer.append(fragment);
        setStatus("Searching TMDB…", false);
    };

    const resultButton = (item) => {
        const button = document.createElement("button");
        const title = mediaTitle(item);
        const year = mediaYear(item);
        const kind = item.media_type === "movie" ? "Movie" : "Show";
        button.className = "search-result-card";
        button.type = "button";
        button.setAttribute("aria-label", `View ${title}${year ? ` (${year})` : ""} details`);
        button.title = `${title}${year ? ` (${year})` : ""}`;

        const poster = imageURL(item.poster_path);
        if (poster) {
            const image = document.createElement("img");
            image.src = poster;
            image.alt = `${title} poster`;
            image.loading = "lazy";
            image.decoding = "async";
            button.append(image);
        } else {
            const fallback = document.createElement("span");
            fallback.className = "search-result-fallback";
            fallback.textContent = title;
            button.append(fallback);
        }

        const type = document.createElement("span");
        type.className = "search-result-type";
        type.textContent = kind;
        button.append(type);
        button.addEventListener("click", () => openDetails(item));
        return button;
    };

    function renderResults() {
        resultsContainer.replaceChildren();
        const query = searchInput.value.trim();
        const filtered = activeFilter === "all"
            ? allResults
            : allResults.filter((item) => item.media_type === activeFilter);

        if (!query) {
            resultsTitle.textContent = "Movies & Shows";
            setStatus("Search for a movie or show to see it here.");
            return;
        }

        resultsTitle.textContent = `Results for “${query}”`;
        if (!filtered.length) {
            const label = activeFilter === "movie" ? "movies" : activeFilter === "tv" ? "shows" : "movies or shows";
            setStatus(`No ${label} found for “${query}”.`);
            return;
        }

        setStatus(`${filtered.length} result${filtered.length === 1 ? "" : "s"} found.`, false);
        const fragment = document.createDocumentFragment();
        filtered.forEach((item) => fragment.append(resultButton(item)));
        resultsContainer.append(fragment);
    }

    const searchTMDB = async () => {
        const query = searchInput.value.trim();
        searchRequest?.abort();
        allResults = [];

        if (!query) {
            renderResults();
            return;
        }

        const request = new AbortController();
        searchRequest = request;
        renderSkeletons();
        resultsTitle.textContent = `Results for “${query}”`;

        try {
            const parameters = { query, include_adult: "false", page: "1" };
            const [movieResponse, showResponse] = await Promise.allSettled([
                getJSON(apiURL("/search/movie", parameters), request.signal),
                getJSON(apiURL("/search/tv", parameters), request.signal)
            ]);

            if (request.signal.aborted || searchRequest !== request) return;
            if (movieResponse.status === "rejected" && showResponse.status === "rejected") {
                throw movieResponse.reason;
            }

            const movies = movieResponse.status === "fulfilled"
                ? (movieResponse.value.results || []).map((item) => ({ ...item, media_type: "movie" }))
                : [];
            const shows = showResponse.status === "fulfilled"
                ? (showResponse.value.results || []).map((item) => ({ ...item, media_type: "tv" }))
                : [];

            const seen = new Set();
            allResults = [...movies, ...shows]
                .filter((item) => {
                    const key = `${item.media_type}-${item.id}`;
                    if (!item.id || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort((a, b) => {
                    const popularityDifference = (b.popularity || 0) - (a.popularity || 0);
                    return popularityDifference || mediaTitle(a).localeCompare(mediaTitle(b));
                })
                .slice(0, 40);

            renderResults();
        } catch (error) {
            if (error?.name === "AbortError") return;
            resultsContainer.replaceChildren();
            setStatus("Binge couldn’t reach TMDB. Please try again in a moment.");
        }
    };

    const queueSearch = () => {
        window.clearTimeout(searchTimer);
        searchRequest?.abort();
        updateInputState();
        if (!searchInput.value.trim()) {
            allResults = [];
            renderResults();
            return;
        }
        renderSkeletons();
        searchTimer = window.setTimeout(searchTMDB, SEARCH_DELAY);
    };

    const formatDate = (dateValue) => {
        if (!dateValue) return "";
        const [year, month, day] = dateValue.slice(0, 10).split("-").map(Number);
        if (!year || !month || !day) return dateValue;
        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        }).format(new Date(year, month - 1, day));
    };

    const formatRuntime = (minutes) => {
        if (!minutes) return "";
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        if (!hours) return `${remainder}m`;
        return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
    };

    const certificationFor = (details, kind) => {
        if (kind === "movie") {
            const region = details.release_dates?.results?.find((item) => item.iso_3166_1 === "US");
            return region?.release_dates?.find((item) => item.certification)?.certification || "";
        }
        const ratings = details.content_ratings?.results || [];
        return ratings.find((item) => item.iso_3166_1 === "US" && item.rating)?.rating ||
            ratings.find((item) => item.rating)?.rating || "";
    };

    const originalLanguageName = (code) => {
        if (!code) return "";
        try {
            return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code.toUpperCase();
        } catch {
            return code.toUpperCase();
        }
    };

    const relativeDate = (dateValue) => {
        if (!dateValue) return "";
        const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
        if (Number.isNaN(date.getTime())) return "";
        const differenceInDays = Math.round((date.getTime() - Date.now()) / 86400000);
        const absoluteDays = Math.abs(differenceInDays);
        let value = differenceInDays;
        let unit = "day";
        if (absoluteDays >= 365) {
            value = Math.round(differenceInDays / 365);
            unit = "year";
        } else if (absoluteDays >= 30) {
            value = Math.round(differenceInDays / 30);
            unit = "month";
        } else if (absoluteDays >= 7) {
            value = Math.round(differenceInDays / 7);
            unit = "week";
        }
        return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
    };

    const detailMetric = (symbol, label, value) => value ? `
        <div class="detail-metric">
            <div class="detail-metric-label"><span aria-hidden="true">${escapeHTML(symbol)}</span>${escapeHTML(label)}</div>
            <strong>${escapeHTML(value)}</strong>
        </div>` : "";

    const detailAboutRow = (label, value, tone = "neutral") => value ? `
        <div class="detail-about-row">
            <span class="detail-about-dot detail-about-dot--${escapeHTML(tone)}" aria-hidden="true"></span>
            <span class="detail-about-label">${escapeHTML(label)}</span>
            <span class="detail-about-value">${escapeHTML(value)}</span>
        </div>` : "";

    const renderDetail = (details, kind) => {
        const title = mediaTitle(details);
        const releaseDate = mediaDate(details);
        const runtime = kind === "movie" ? details.runtime : details.episode_run_time?.[0];
        const certification = certificationFor(details, kind);
        const rating = Number(details.vote_average) > 0 ? `${Number(details.vote_average).toFixed(1)} /10` : "";
        const director = kind === "movie"
            ? (details.credits?.crew || []).filter((person) => person.job === "Director").slice(0, 3).map((person) => person.name).join(", ")
            : (details.created_by || []).slice(0, 3).map((person) => person.name).join(", ");
        const cast = (details.credits?.cast || []).slice(0, 10);
        const crewRoleOrder = [
            "Creator",
            "Director",
            "Executive Producer",
            "Producer",
            "Screenplay",
            "Writer",
            "Director of Photography",
            "Original Music Composer"
        ];
        const crewRole = (person) => person.job || person.department || person.known_for_department || "Crew";
        const crewPriority = (person) => {
            const priority = crewRoleOrder.indexOf(crewRole(person));
            return priority === -1 ? crewRoleOrder.length : priority;
        };
        const crewCandidates = [
            ...(kind === "tv" ? (details.created_by || []).map((person) => ({ ...person, job: "Creator" })) : []),
            ...(details.credits?.crew || [])
        ].sort((first, second) => crewPriority(first) - crewPriority(second));
        const seenCrew = new Set();
        const crew = crewCandidates.filter((person) => {
            const key = person.id || person.name;
            if (!key || seenCrew.has(key)) return false;
            seenCrew.add(key);
            return true;
        }).slice(0, 10);
        const providerRegion = details["watch/providers"]?.results?.US || {};
        const providerSource = providerRegion.flatrate?.length
            ? providerRegion.flatrate
            : providerRegion.buy?.length
                ? providerRegion.buy
                : providerRegion.rent || [];
        const providerType = providerRegion.flatrate?.length ? "Streaming" : providerRegion.buy?.length ? "Available to buy" : "Available to rent";
        const providers = [...new Map(providerSource.map((provider) => [provider.provider_id, provider])).values()].slice(0, 8);
        const genres = (details.genres || []).map((genre) => genre.name);
        const countries = kind === "movie"
            ? (details.production_countries || []).map((country) => country.name).slice(0, 3).join(", ")
            : (details.origin_country || []).join(", ");
        const poster = imageURL(details.poster_path);
        const backdrop = imageURL(details.backdrop_path, "w1280");
        const seasonCount = kind === "tv" && details.number_of_seasons ? String(details.number_of_seasons) : "";
        const episodeCount = kind === "tv" && details.number_of_episodes ? String(details.number_of_episodes) : "";
        const releaseLine = [formatDate(releaseDate), relativeDate(releaseDate)].filter(Boolean).join(" · ");
        const primaryGenre = genres[0] || "";
        const spokenLanguages = (details.spoken_languages || [])
            .map((language) => language.english_name || language.name)
            .filter(Boolean)
            .join(", ");
        const networks = (details.networks || []).map((network) => network.name).filter(Boolean).join(", ");
        const companies = (details.production_companies || []).slice(0, 3).map((company) => company.name).filter(Boolean).join(", ");
        const statusTone = details.status === "Released" ? "green"
            : details.status === "Returning Series" ? "mint"
                : details.status === "Ended" ? "pink"
                    : details.status === "Planned" ? "orange"
                        : "blue";

        const providerCards = providers.map((provider) => {
            const logo = imageURL(provider.logo_path, "w185");
            return `<div class="detail-provider">
                ${logo ? `<img src="${escapeHTML(logo)}" alt="">` : `<span>${escapeHTML(provider.provider_name.slice(0, 2))}</span>`}
                <span>${escapeHTML(provider.provider_name)}</span>
            </div>`;
        }).join("");

        const personCards = (people, subtitleFor) => people.map((person) => {
            const profile = imageURL(person.profile_path, "w185");
            const initials = person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
            const subtitle = subtitleFor(person);
            return `<article class="detail-person">
                <div class="detail-person-image">
                    ${profile ? `<img src="${escapeHTML(profile)}" alt="" loading="lazy" decoding="async">` : `<span>${escapeHTML(initials)}</span>`}
                </div>
                <strong>${escapeHTML(person.name)}</strong>
                ${subtitle ? `<span>${escapeHTML(subtitle)}</span>` : ""}
            </article>`;
        }).join("");
        const castCards = personCards(cast, (person) => person.character);
        const crewCards = personCards(crew, crewRole);

        const metrics = [
            detailMetric("★", "TMDB", rating),
            detailMetric("◷", "Runtime", formatRuntime(runtime)),
            detailMetric("▤", "Seasons", seasonCount),
            detailMetric("▦", "Episodes", episodeCount),
            detailMetric("◈", "Genre", primaryGenre),
            detailMetric("!", kind === "movie" ? "Certificate" : "Rating", certification)
        ].join("");

        const aboutRows = [
            detailAboutRow(kind === "movie" ? "Director" : "Created By", director),
            detailAboutRow("Networks", networks),
            detailAboutRow(kind === "movie" ? "Release" : "First Aired", formatDate(releaseDate), "indigo"),
            detailAboutRow("Spoken Languages", spokenLanguages),
            detailAboutRow("Genres", genres.join(", ")),
            detailAboutRow(kind === "movie" ? "Production Country" : "Origin", countries),
            detailAboutRow("Production", companies),
            detailAboutRow("Status", details.status, statusTone)
        ].join("");

        dialogContent.innerHTML = `
            <button class="media-dialog-close" type="button" data-close-dialog aria-label="Close details"><span class="xmark-icon" aria-hidden="true"></span></button>
            <div class="detail-visual"${backdrop ? ` style="background-image: url('${escapeHTML(backdrop)}')"` : ""}>
                <div class="detail-poster-wrap">
                    ${poster
                        ? `<img src="${escapeHTML(poster)}" alt="${escapeHTML(title)} poster">`
                        : `<span class="search-result-fallback">${escapeHTML(title)}</span>`}
                </div>
            </div>
            <div class="detail-body">
                <section class="detail-intro">
                    <h2 id="media-dialog-title">${escapeHTML(title)}</h2>
                    ${releaseLine ? `<p class="detail-release">${escapeHTML(releaseLine)}</p>` : ""}
                    <div class="detail-actions" aria-label="Binge actions">
                        <button class="detail-action detail-action--watchlist" type="button" data-detail-action="watchlist">
                            <span class="detail-action-icon" aria-hidden="true">+</span>
                            <span class="detail-action-label">Watchlist</span>
                        </button>
                        <button class="detail-action detail-action--watched is-active" type="button" data-detail-action="watched" data-active-label="${kind === "movie" ? "Watched" : "Watching"}">
                            <span class="detail-action-icon" aria-hidden="true">✓</span>
                            <span class="detail-action-label">${kind === "movie" ? "Watched" : "Watching"}</span>
                        </button>
                    </div>
                    ${details.overview ? `
                        <p class="detail-overview" data-detail-overview>${escapeHTML(details.overview)}</p>
                        ${details.overview.length > 180 ? `<button class="detail-read-more" type="button" data-detail-read-more>Show more <span aria-hidden="true">⌄</span></button>` : ""}
                    ` : ""}
                </section>
                ${metrics ? `<div class="detail-metrics" aria-label="Title metrics">${metrics}</div>` : ""}
                ${providerCards ? `
                    <section class="detail-section">
                        <div class="detail-section-heading"><div><h3>Where to Watch</h3><p>${escapeHTML(providerType)}</p></div></div>
                        <div class="detail-providers">${providerCards}</div>
                    </section>` : ""}
                ${castCards ? `
                    <section class="detail-section">
                        <div class="detail-section-heading"><div><h3>Cast</h3><p>${escapeHTML(cast.length)} featured cast members</p></div></div>
                        <div class="detail-people">${castCards}</div>
                    </section>` : ""}
                ${crewCards ? `
                    <section class="detail-section">
                        <div class="detail-section-heading"><div><h3>Crew</h3><p>${escapeHTML(crew.length)} featured crew members</p></div></div>
                        <div class="detail-people">${crewCards}</div>
                    </section>` : ""}
                ${aboutRows ? `
                    <section class="detail-section detail-section--about">
                        <div class="detail-section-heading"><div><h3>About</h3><p>Movie and show information</p></div></div>
                        <div class="detail-about-list">${aboutRows}</div>
                    </section>` : ""}
            </div>`;
    };

    async function openDetails(item) {
        detailRequest?.abort();
        const request = new AbortController();
        detailRequest = request;
        const kind = item.media_type === "movie" ? "movie" : "tv";
        const append = kind === "movie"
            ? "credits,release_dates,watch/providers,external_ids"
            : "credits,content_ratings,watch/providers,external_ids";

        dialogContent.innerHTML = `
            <button class="media-dialog-close" type="button" data-close-dialog aria-label="Close details"><span class="xmark-icon" aria-hidden="true"></span></button>
            <div class="detail-loading" role="status">Loading ${escapeHTML(mediaTitle(item))}…</div>`;
        if (!mediaDialog.open) mediaDialog.showModal();

        try {
            const details = await getJSON(
                apiURL(`/${kind}/${item.id}`, { append_to_response: append }),
                request.signal
            );
            if (!request.signal.aborted && detailRequest === request) renderDetail(details, kind);
        } catch (error) {
            if (error?.name === "AbortError") return;
            dialogContent.innerHTML = `
                <button class="media-dialog-close" type="button" data-close-dialog aria-label="Close details"><span class="xmark-icon" aria-hidden="true"></span></button>
                <div class="detail-loading" role="alert">Those details couldn’t be loaded. Please try again.</div>`;
        }
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const applyOpenSearchState = () => {
        document.body.classList.add("search-active");
        searchExperience.setAttribute("aria-hidden", "false");
        window.scrollTo(0, 0);
    };

    const openSearch = () => {
        lastScrollPosition = window.scrollY;
        if (typeof document.startViewTransition === "function" && !prefersReducedMotion.matches) {
            const transition = document.startViewTransition(applyOpenSearchState);
            transition.finished
                .catch(() => {})
                .finally(() => searchInput.focus());
            return;
        }

        document.body.classList.add("search-fallback-entering");
        applyOpenSearchState();
        window.setTimeout(() => {
            document.body.classList.remove("search-fallback-entering");
            searchInput.focus();
        }, prefersReducedMotion.matches ? 0 : 560);
    };

    const applyClosedSearchState = () => {
        document.body.classList.remove("search-active");
        searchExperience.setAttribute("aria-hidden", "true");
        window.scrollTo(0, lastScrollPosition);
    };

    const closeSearch = () => {
        window.clearTimeout(searchTimer);
        searchRequest?.abort();
        detailRequest?.abort();
        if (mediaDialog.open) mediaDialog.close();
        searchInput.value = "";
        allResults = [];
        setFilter("all");
        updateInputState();
        if (typeof document.startViewTransition === "function" && !prefersReducedMotion.matches) {
            const transition = document.startViewTransition(applyClosedSearchState);
            transition.finished
                .catch(() => {})
                .finally(() => launchButton.focus({ preventScroll: true }));
            return;
        }

        applyClosedSearchState();
        launchButton.focus({ preventScroll: true });
    };

    launchButton.addEventListener("click", openSearch);
    exitButton.addEventListener("click", closeSearch);
    searchInput.addEventListener("input", queueSearch);
    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        window.clearTimeout(searchTimer);
        searchTMDB();
        searchInput.blur();
    });
    clearButton.addEventListener("click", () => {
        searchInput.value = "";
        queueSearch();
        searchInput.focus();
    });
    filterButtons.forEach((button) => {
        button.addEventListener("click", () => setFilter(button.dataset.filter || "all"));
    });
    dialogContent.addEventListener("click", (event) => {
        if (event.target.closest("[data-close-dialog]")) {
            mediaDialog.close();
            return;
        }

        const readMoreButton = event.target.closest("[data-detail-read-more]");
        if (readMoreButton) {
            const overview = dialogContent.querySelector("[data-detail-overview]");
            const isExpanded = overview?.classList.toggle("is-expanded") || false;
            readMoreButton.innerHTML = `${isExpanded ? "Show less" : "Show more"} <span aria-hidden="true">${isExpanded ? "⌃" : "⌄"}</span>`;
            return;
        }

        const actionButton = event.target.closest("[data-detail-action]");
        if (actionButton) {
            const isActive = actionButton.classList.toggle("is-active");
            const icon = actionButton.querySelector(".detail-action-icon");
            const label = actionButton.querySelector(".detail-action-label");
            if (actionButton.dataset.detailAction === "watchlist") {
                if (icon) icon.textContent = isActive ? "✓" : "+";
                if (label) label.textContent = isActive ? "In Watchlist" : "Watchlist";
            } else {
                if (icon) icon.textContent = isActive ? "✓" : "+";
                if (label) label.textContent = isActive ? actionButton.dataset.activeLabel : "Mark Watched";
            }
        }
    });
    mediaDialog.addEventListener("click", (event) => {
        if (event.target === mediaDialog) mediaDialog.close();
    });
    mediaDialog.addEventListener("close", () => detailRequest?.abort());
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.body.classList.contains("search-active") && !mediaDialog.open) {
            closeSearch();
        }
    });
})();
