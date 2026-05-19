#!/usr/bin/env node

import { createServer } from "node:http";
import { buildSuperstarsSvg, DEFAULTS, parseRepo } from "./superstars.mjs";

const DEFAULT_PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(process.env.CACHE_TTL_SECONDS || "21600", 10);
const cache = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    if (url.pathname === "/") {
      sendHtml(response, renderHomePage(request));
      return;
    }

    if (url.pathname === "/health") {
      sendText(response, 200, usageText(request));
      return;
    }

    const route = parseSvgRoute(url.pathname);
    if (!route) {
      sendText(response, 404, "Expected /owner/repo.svg");
      return;
    }

    const options = optionsFromSearchParams(url.searchParams);
    const cacheKey = JSON.stringify({ ...route, ...options });
    const cached = getCached(cacheKey);

    if (cached) {
      sendSvg(response, cached.svg, cached.ageSeconds, request.method);
      return;
    }

    const svg = await buildSuperstarsSvg({
      ...options,
      repo: `${route.owner}/${route.name}`,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    });

    cache.set(cacheKey, { svg, expiresAt: Date.now() + DEFAULT_CACHE_TTL_SECONDS * 1000, createdAt: Date.now() });
    sendSvg(response, svg, 0, request.method);
  } catch (error) {
    const svg = renderErrorSvg(error);
    response.writeHead(400, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(svg);
  }
});

server.listen(DEFAULT_PORT, () => {
  console.log(`Superstars listening on http://localhost:${DEFAULT_PORT}`);
  console.log(`Try http://localhost:${DEFAULT_PORT}/owner/repo.svg?demo=1`);
});

function parseSvgRoute(pathname) {
  if (!pathname.endsWith(".svg")) {
    return null;
  }

  const parts = pathname.slice(1, -4).split("/").map(decodeURIComponent);
  if (parts.length !== 2) {
    return null;
  }

  const [owner, name] = parts;
  parseRepo(`${owner}/${name}`);
  return { owner, name };
}

function optionsFromSearchParams(searchParams) {
  return {
    limit: readInt(searchParams, "limit", DEFAULTS.limit),
    maxStarredReposPerUser: readInt(
      searchParams,
      "maxStarredReposPerUser",
      readInt(
        searchParams,
        "max_starred_repos_per_user",
        readInt(searchParams, "maxStargazers", readInt(searchParams, "max_stargazers", DEFAULTS.maxStarredReposPerUser)),
      ),
    ),
    batchSize: readInt(searchParams, "batchSize", readInt(searchParams, "batch_size", DEFAULTS.batchSize)),
    theme: searchParams.get("theme") || DEFAULTS.theme,
    format: searchParams.get("format") || searchParams.get("layout") || DEFAULTS.format,
    demo: readBool(searchParams, "demo"),
  };
}

function readInt(searchParams, key, fallback) {
  const value = searchParams.get(key);
  if (value === null || value === "") {
    return fallback;
  }

  return Number.parseInt(value, 10);
}

function readBool(searchParams, key) {
  const value = searchParams.get(key);
  return value === "1" || value === "true" || value === "yes";
}

function getCached(key) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return {
    svg: cached.svg,
    ageSeconds: Math.floor((Date.now() - cached.createdAt) / 1000),
  };
}

function sendSvg(response, svg, ageSeconds, method) {
  response.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": `public, max-age=${Math.min(DEFAULT_CACHE_TTL_SECONDS, 3600)}, stale-while-revalidate=${DEFAULT_CACHE_TTL_SECONDS}`,
    Age: String(ageSeconds),
    "Access-Control-Allow-Origin": "*",
  });

  if (method === "HEAD") {
    response.end();
    return;
  }

  response.end(svg);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  response.end(body);
}

function usageText(request) {
  const host = request.headers.host || "localhost:3000";
  return `Superstars

Embed:
![Superstars](https://${host}/owner/repo.svg)

Local demo:
http://${host}/owner/repo.svg?demo=1

Options:
limit=6
maxStarredReposPerUser=1000
batchSize=10
theme=light|dark
format=card|compact|compact-blurbs
demo=1

List:
https://github.com/ron-ulitsky/superstars
`;
}

function renderHomePage(request) {
  const host = request.headers.host || "localhost:3000";
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProtocol === "string"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  const origin = `${protocol}://${host}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Superstars</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fa;
      --panel: #ffffff;
      --text: #24292f;
      --muted: #57606a;
      --border: #d0d7de;
      --accent: #9a6700;
      --accent-bg: #fff8c5;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
    }

    main {
      width: min(960px, calc(100% - 32px));
      margin: 0 auto;
      padding: 56px 0;
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(32px, 5vw, 56px);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .lede {
      max-width: 720px;
      margin: 0 0 28px;
      color: var(--muted);
      font-size: 18px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }

    label {
      display: block;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: end;
    }

    input, select, button, textarea {
      font: inherit;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      background: #fff;
      color: var(--text);
    }

    button {
      border: 1px solid #7d5f00;
      border-radius: 6px;
      padding: 10px 14px;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    button.secondary {
      background: var(--accent-bg);
      color: var(--accent);
      border-color: #d4a72c;
    }

    .output {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .preview {
      overflow-x: auto;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
    }

    .preview img {
      max-width: 100%;
      height: auto;
      display: block;
    }

    .copy-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
    }

    .hint, .status {
      color: var(--muted);
      font-size: 14px;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 22px;
    }

    a {
      color: #0969da;
      text-decoration: none;
    }

    a:hover { text-decoration: underline; }

    @media (max-width: 720px) {
      main { padding: 32px 0; }
      .controls, .copy-row { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Superstars</h1>
    <p class="lede">Generate a README badge showing notable people who starred a GitHub repository.</p>

    <section class="panel" aria-labelledby="try-heading">
      <h2 id="try-heading">Try It On Your Repo</h2>
      <div class="controls">
        <div>
          <label for="repo">Repository</label>
          <input id="repo" value="facebook/react" placeholder="owner/repo" autocomplete="off" spellcheck="false">
        </div>
        <div>
          <label for="theme">Theme</label>
          <select id="theme">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div>
          <label for="format">Format</label>
          <select id="format">
            <option value="card">Card</option>
            <option value="compact">Compact</option>
            <option value="compact-blurbs">Compact + blurbs</option>
          </select>
        </div>
        <button id="copyMarkdown">Copy Markdown</button>
      </div>

      <div class="output">
        <div>
          <label for="markdown">Markdown</label>
          <div class="copy-row">
            <textarea id="markdown" rows="2" readonly></textarea>
            <button class="secondary" id="copyMarkdown2">Copy</button>
          </div>
        </div>

        <div>
          <label for="url">Image URL</label>
          <div class="copy-row">
            <input id="url" readonly>
            <button class="secondary" id="copyUrl">Copy</button>
          </div>
        </div>

        <div class="preview">
          <img id="preview" alt="Superstars badge preview">
        </div>

        <div class="status" id="status" role="status" aria-live="polite"></div>
      </div>
    </section>

    <p class="hint">Tip: if your repo has no matches yet, the badge will say so. That is still useful information.</p>

    <nav class="links" aria-label="Project links">
      <a href="https://github.com/ron-ulitsky/superstars">GitHub</a>
      <a href="https://github.com/ron-ulitsky/superstars/blob/main/data/superstars.json">Superstars list</a>
      <a href="https://github.com/ron-ulitsky/superstars/blob/main/SUPERSTARS.md">Suggest changes</a>
      <a href="https://github.com/ron-ulitsky/superstars/blob/main/EXAMPLES.md">Examples</a>
    </nav>
  </main>

  <script>
    const origin = ${JSON.stringify(origin)};
    const repoInput = document.querySelector("#repo");
    const themeInput = document.querySelector("#theme");
    const formatInput = document.querySelector("#format");
    const markdown = document.querySelector("#markdown");
    const url = document.querySelector("#url");
    const preview = document.querySelector("#preview");
    const status = document.querySelector("#status");

    function normalizeRepo(value) {
      return value
        .trim()
        .replace(/^https:\\/\\/github\\.com\\//, "")
        .replace(/\\.git$/, "")
        .replace(/^\\/+|\\/+$/g, "");
    }

    function update() {
      const repo = normalizeRepo(repoInput.value) || "owner/repo";
      const theme = themeInput.value;
      const format = formatInput.value;
      const params = new URLSearchParams();

      if (theme === "dark") {
        params.set("theme", "dark");
      }

      if (format !== "card") {
        params.set("format", format);
      }

      const query = params.toString();
      const imageUrl = origin + "/" + repo + ".svg" + (query ? "?" + query : "");
      const markdownValue = "![Notable people who starred this project](" + imageUrl + ")";

      url.value = imageUrl;
      markdown.value = markdownValue;
      preview.src = imageUrl;
    }

    async function copy(value, label) {
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = "Copied " + label + ".";
      } catch {
        status.textContent = "Select the text and copy it manually.";
      }
    }

    repoInput.addEventListener("input", update);
    themeInput.addEventListener("change", update);
    formatInput.addEventListener("change", update);
    document.querySelector("#copyMarkdown").addEventListener("click", () => copy(markdown.value, "Markdown"));
    document.querySelector("#copyMarkdown2").addEventListener("click", () => copy(markdown.value, "Markdown"));
    document.querySelector("#copyUrl").addEventListener("click", () => copy(url.value, "URL"));
    update();
  </script>
</body>
</html>`;
}

function renderErrorSvg(error) {
  const message = escapeXml(error.message || "Unknown error");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="120" viewBox="0 0 720 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Superstars error">
  <rect x="0.5" y="0.5" width="719" height="119" rx="10" fill="#fff8f8" stroke="#ffb3b3"/>
  <text x="24" y="40" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#b42318">Superstars unavailable</text>
  <text x="24" y="70" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="#57606a">${message}</text>
</svg>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
