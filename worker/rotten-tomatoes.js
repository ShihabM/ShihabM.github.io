const RT_ORIGIN = "https://www.rottentomatoes.com";

const percentage = (value) => {
    const text = String(value ?? "").trim();
    if (!/^\d{1,3}%?$/.test(text)) return "";
    const score = Number.parseInt(text, 10);
    return score <= 100 ? `${score}%` : "";
};

export const parseRottenTomatoesScores = (html) => {
    let data = {};
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\bdata-json\s*=\s*["']mediaScorecard["']/i.test(script[1])) continue;
        try { data = JSON.parse(script[2]); } catch { /* Fall back to the visible scorecard. */ }
        break;
    }
    // Restrict fallbacks to the title's scorecard, avoiding recommendations and reviews.
    const scorecard = html.match(/<media-scorecard\b[^>]*>([\s\S]*?)<\/media-scorecard\s*>/i)?.[1] || "";
    const slotScore = (kind) => scorecard.match(new RegExp(
        `<rt-text\\b[^>]*\\bslot\\s*=\\s*["']${kind}-score["'][^>]*>\\s*(\\d{1,3}%?)\\s*</rt-text\\s*>`, "i"
    ))?.[1];
    const legacy = html.match(/<score-board\b[^>]*>/i)?.[0] || "";
    const attributeScore = (name) => legacy.match(new RegExp(`\\b${name}\\s*=\\s*["'](\\d{1,3})["']`, "i"))?.[1];
    return {
        critics: percentage(data.criticsScore?.scorePercent) || percentage(data.criticsScore?.score) ||
            percentage(slotScore("critics")) || percentage(attributeScore("tomatometerscore")),
        audience: percentage(data.audienceScore?.scorePercent) || percentage(data.audienceScore?.score) ||
            percentage(slotScore("audience")) || percentage(attributeScore("audiencescore")),
        criticsCertified: data.criticsScore?.certified === true ||
            /<score-icon-critics\b[^>]*\bcertified\s*=\s*["']true["']/i.test(scorecard)
    };
};

export const rottenTomatoesURLs = (details, kind, season) => {
    const slug = String(details.title || details.name || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/\s+-\s+|:\s+|\s+|-/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!slug) return [];
    const year = (details.release_date || details.first_air_date || "").slice(0, 4);
    const years = /^\d{4}$/.test(year) ? [year] : [];
    if (kind === "movie" && years.length) years.push(String(Number(year) - 1));
    years.push("");
    const suffix = kind === "tv" ? `/s${String(season).padStart(2, "0")}` : "";
    return [...new Set(years.map(value => new URL(
        `/${kind === "movie" ? "m" : "tv"}/${slug}${value ? `_${value}` : ""}${suffix}`, RT_ORIGIN
    ).href))];
};

const fetchPage = async (source, fetchImpl, signal) => {
    let url = new URL(source);
    for (let redirects = 0; redirects <= 2; redirects++) {
        const response = await fetchImpl(url, {
            headers: { accept: "text/html" }, redirect: "manual", signal
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (!location) throw new Error("Missing Rotten Tomatoes redirect");
            const next = new URL(location, url);
            if (next.origin !== RT_ORIGIN || !/^\/(m|tv)\//.test(next.pathname) || next.username || next.password) {
                throw new Error("Invalid Rotten Tomatoes redirect");
            }
            url = next;
            continue;
        }
        if (!response.ok) throw new Error("Rotten Tomatoes page unavailable");
        return response.text();
    }
    throw new Error("Too many Rotten Tomatoes redirects");
};

export const fetchRottenTomatoesScores = async (details, kind, season, fetchImpl = fetch) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6500)]);
    try {
        return await Promise.any(rottenTomatoesURLs(details, kind, season).map(async url => {
            const html = await fetchPage(url, fetchImpl, signal);
            const releaseYear = Number(details.release_date?.slice(0, 4));
            const pageYear = Number(html.match(/"dateCreated"\s*:\s*"(\d{4})-\d{2}-\d{2}"/)?.[1]);
            if (kind === "movie" && releaseYear && pageYear && Math.abs(releaseYear - pageYear) > 1) {
                throw new Error("Rotten Tomatoes release year mismatch");
            }
            const scores = parseRottenTomatoesScores(html);
            if (!scores.critics && !scores.audience) throw new Error("Rotten Tomatoes scores unavailable");
            return scores;
        }));
    } catch {
        return {};
    } finally {
        // Stop unused URL candidates once a scorecard has been found.
        controller.abort();
    }
};
