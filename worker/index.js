const API_PREFIX = "/api/tmdb";
const TMDB_ORIGIN = "https://api.themoviedb.org";
const DEFAULT_ALLOWED_ORIGIN = "https://binge.movie";

const JSON_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "vary": "Origin"
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store", ...headers }
});

const corsHeaders = (origin) => origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Accept",
    "access-control-max-age": "86400",
    "vary": "Origin"
} : {};

const allowedOrigin = (request, env, requestURL) => {
    const origin = request.headers.get("origin");
    if (!origin) return "";
    const configuredOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    return origin === requestURL.origin || origin === configuredOrigin ? origin : null;
};

const positiveInteger = (value) => /^(?:[1-9]\d{0,9})$/.test(value);
const seasonInteger = (value) => /^(?:0|[1-9]\d{0,3})$/.test(value);

export const createUpstreamURL = (requestURL, apiKey) => {
    const path = requestURL.pathname.slice(API_PREFIX.length);
    const upstream = new URL("/3", TMDB_ORIGIN);

    const searchMatch = path.match(/^\/search\/(movie|tv)$/);
    if (searchMatch) {
        const query = requestURL.searchParams.get("query")?.trim() || "";
        const onlyQuery = [...requestURL.searchParams.keys()].every((key) => key === "query");
        if (!query || query.length > 120 || !onlyQuery || requestURL.searchParams.getAll("query").length !== 1) {
            return { error: "A valid search query is required.", status: 400 };
        }
        upstream.pathname = `/3/search/${searchMatch[1]}`;
        upstream.searchParams.set("query", query);
        upstream.searchParams.set("include_adult", "false");
        upstream.searchParams.set("page", "1");
    } else {
        const detailMatch = path.match(/^\/(movie|tv)\/([^/]+)$/);
        const seasonMatch = path.match(/^\/tv\/([^/]+)\/season\/([^/]+)$/);
        if (detailMatch && positiveInteger(detailMatch[2]) && requestURL.search === "") {
            const kind = detailMatch[1];
            upstream.pathname = `/3/${kind}/${detailMatch[2]}`;
            upstream.searchParams.set(
                "append_to_response",
                kind === "movie"
                    ? "credits,release_dates,watch/providers,external_ids"
                    : "credits,content_ratings,watch/providers,external_ids"
            );
        } else if (
            seasonMatch &&
            positiveInteger(seasonMatch[1]) &&
            seasonInteger(seasonMatch[2]) &&
            requestURL.search === ""
        ) {
            upstream.pathname = `/3/tv/${seasonMatch[1]}/season/${seasonMatch[2]}`;
        } else {
            return { error: "TMDB endpoint not found.", status: 404 };
        }
    }

    upstream.searchParams.set("language", "en-US");
    upstream.searchParams.set("api_key", apiKey);
    return { url: upstream };
};

const rateLimitKey = (request, requestURL) => {
    const client = request.headers.get("cf-connecting-ip") || "unknown-client";
    const routeClass = requestURL.pathname.includes("/search/") ? "search" : "details";
    return `${client}:${routeClass}`;
};

const applyRateLimit = async (request, env, requestURL) => {
    const result = await env.TMDB_RATE_LIMITER.limit({ key: rateLimitKey(request, requestURL) });
    return result.success;
};

export const handleRequest = async (request, env, fetchImpl = fetch) => {
    const requestURL = new URL(request.url);

    if (!requestURL.pathname.startsWith(`${API_PREFIX}/`)) {
        return env.ASSETS?.fetch ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    const origin = allowedOrigin(request, env, requestURL);
    if (origin === null) return json({ error: "Origin not allowed." }, 403);
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405, { ...cors, allow: "GET, OPTIONS" });
    }
    if (!env.TMDB_API_KEY || !env.TMDB_RATE_LIMITER?.limit) {
        return json({ error: "Movie data is temporarily unavailable." }, 503, cors);
    }

    const target = createUpstreamURL(requestURL, env.TMDB_API_KEY);
    if (!target.url) return json({ error: target.error }, target.status, cors);

    try {
        if (!(await applyRateLimit(request, env, requestURL))) {
            return json({ error: "Too many requests. Please try again shortly." }, 429, {
                ...cors,
                "retry-after": "60"
            });
        }
        const isSearch = requestURL.pathname.includes("/search/");
        const cacheURL = new URL(target.url);
        cacheURL.searchParams.delete("api_key");
        const upstreamResponse = await fetchImpl(target.url, {
            headers: { accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            cf: {
                cacheEverything: true,
                cacheTtlByStatus: { "200-299": isSearch ? 300 : 3600, "300-599": -1 },
                cacheKey: cacheURL.toString()
            }
        });
        if (!upstreamResponse.ok) {
            const status = upstreamResponse.status === 404 ? 404 : 502;
            return json({ error: "Movie data is temporarily unavailable." }, status, cors);
        }
        const body = await upstreamResponse.arrayBuffer();
        return new Response(body, {
            status: upstreamResponse.status,
            headers: {
                ...JSON_HEADERS,
                ...cors,
                "cache-control": isSearch
                    ? "public, max-age=60, s-maxage=300"
                    : "public, max-age=300, s-maxage=3600"
            }
        });
    } catch (error) {
        console.error("TMDB upstream request failed", { name: error?.name || "Error" });
        return json({ error: "Movie data is temporarily unavailable." }, 502, cors);
    }
};

export default {
    fetch(request, env) {
        return handleRequest(request, env);
    }
};
