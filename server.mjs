import http from "node:http";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createWeReadClient, SKILL_VERSION, syncWeRead, WeReadError } from "./weread.mjs";
import { askOpenAI, DEFAULT_MODEL, OpenAIProviderError, validOpenAIKey } from "./openai-provider.mjs";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const envPath = join(root, ".env.local");
let wereadApiKey = process.env.WEREAD_API_KEY || "";
let openaiApiKey = process.env.OPENAI_API_KEY || "";
let openaiModel = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const publicPaths = new Set(["/", "/index.html", "/styles.css", "/app.js", "/core.mjs", "/search.mjs", "/map.mjs", "/data.js", "/sample-import.json"]);

try {
  const env = await readFile(envPath, "utf8");
  const match = env.match(/^WEREAD_API_KEY=(.+)$/m);
  if (!wereadApiKey && match) wereadApiKey = match[1].trim().replace(/^['"]|['"]$/g, "");
  const openaiMatch = env.match(/^OPENAI_API_KEY=(.+)$/m);
  const modelMatch = env.match(/^OPENAI_MODEL=(.+)$/m);
  if (!openaiApiKey && openaiMatch) openaiApiKey = openaiMatch[1].trim().replace(/^['"]|['"]$/g, "");
  if (!process.env.OPENAI_MODEL && modelMatch) openaiModel = modelMatch[1].trim().replace(/^['"]|['"]$/g, "");
} catch {}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function saveEnvValue(name, value) {
  let env = "";
  try { env = await readFile(envPath, "utf8"); } catch {}
  const line = `${name}=${value}`;
  const matcher = new RegExp(`^${name}=.*$`, "m");
  env = matcher.test(env) ? env.replace(matcher, line) : `${env.trim()}${env.trim() ? "\n" : ""}${line}\n`;
  await writeFile(envPath, env, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600).catch(() => {});
}

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);

  if (pathname === "/api/weread/status" && request.method === "GET") {
    return json(response, 200, { configured: Boolean(wereadApiKey), keyHint: wereadApiKey ? `wrk-••••${wereadApiKey.slice(-4)}` : "", skillVersion: SKILL_VERSION });
  }

  if (pathname === "/api/weread/config" && request.method === "POST") {
    try {
      const { apiKey } = await readJson(request);
      const call = createWeReadClient(String(apiKey || "").trim());
      await call("/user/notebooks", { count: 1 });
      wereadApiKey = String(apiKey).trim();
      await saveEnvValue("WEREAD_API_KEY", wereadApiKey);
      return json(response, 200, { ok: true, keyHint: `wrk-••••${String(apiKey).slice(-4)}` });
    } catch (error) {
      const status = error instanceof WeReadError && error.code === "INVALID_KEY" ? 400 : 502;
      return json(response, status, { error: error.message || "连接微信读书失败" });
    }
  }

  if (pathname === "/api/weread/sync" && request.method === "POST") {
    if (!wereadApiKey) return json(response, 401, { error: "尚未配置微信读书 API Key" });
    try {
      const options = await readJson(request);
      const notebookLimit = options.notebookLimit === 0 ? 0 : Math.min(1000, Math.max(1, Number(options.notebookLimit) || 20));
      const archive = await syncWeRead({
        apiKey: wereadApiKey,
        includeShelf: Boolean(options.includeShelf),
        notebookLimit,
        onProgress: ({ current, total, title }) => console.log(`[WeRead] ${current}/${total} ${title}`)
      });
      return json(response, 200, archive);
    } catch (error) {
      console.error(`[WeRead] ${error.code || "ERROR"}: ${error.message}`);
      return json(response, 502, { error: error.message || "微信读书同步失败" });
    }
  }

  if (pathname === "/api/openai/status" && request.method === "GET") {
    return json(response, 200, { configured: Boolean(openaiApiKey), keyHint: openaiApiKey ? `sk-••••${openaiApiKey.slice(-4)}` : "", model: openaiModel });
  }

  if (pathname === "/api/openai/config" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const apiKey = String(body.apiKey || "").trim();
      const model = String(body.model || DEFAULT_MODEL).trim().slice(0, 80);
      if (!validOpenAIKey(apiKey)) return json(response, 400, { error: "OpenAI API Key 格式不正确" });
      openaiApiKey = apiKey;
      openaiModel = model || DEFAULT_MODEL;
      await saveEnvValue("OPENAI_API_KEY", openaiApiKey);
      await saveEnvValue("OPENAI_MODEL", openaiModel);
      return json(response, 200, { ok: true, keyHint: `sk-••••${openaiApiKey.slice(-4)}`, model: openaiModel });
    } catch (error) {
      return json(response, 400, { error: error.message || "无法保存 OpenAI 配置" });
    }
  }

  if (pathname === "/api/archive/ask" && request.method === "POST") {
    if (!openaiApiKey) return json(response, 401, { error: "尚未配置 OpenAI API Key" });
    try {
      const body = await readJson(request);
      const answer = await askOpenAI({ apiKey: openaiApiKey, question: body.question, sources: body.sources, model: openaiModel });
      return json(response, 200, answer);
    } catch (error) {
      const status = error instanceof OpenAIProviderError && ["INVALID_QUESTION", "NO_SOURCES"].includes(error.code) ? 400 : 502;
      return json(response, status, { error: error.message || "档案问答失败" });
    }
  }

  if (!publicPaths.has(pathname)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath === "/" ? "index.html" : safePath);

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Reading Archive: http://localhost:${port}`);
});
