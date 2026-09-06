const RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6";

export class OpenAIProviderError extends Error {
  constructor(message, code = "OPENAI_ERROR") {
    super(message);
    this.name = "OpenAIProviderError";
    this.code = code;
  }
}

export function validOpenAIKey(value) {
  return /^sk-[A-Za-z0-9_-]{12,}$/.test(String(value || "").trim());
}

function responseSchema() {
  return {
    type: "object",
    properties: {
      answer: { type: "string" },
      citations: { type: "array", items: { type: "string" } },
      evidenceState: { type: "string", enum: ["sufficient", "partial", "none"] },
      followUps: { type: "array", items: { type: "string" } }
    },
    required: ["answer", "citations", "evidenceState", "followUps"],
    additionalProperties: false
  };
}

export function buildArchiveRequest({ question, sources, model = DEFAULT_MODEL }) {
  return {
    model,
    store: false,
    instructions: [
      "你是用户的私人阅读档案研究助手。只能依据提供的 SOURCES 回答，不得使用外部知识补全。",
      "每个事实性判断后都必须使用方括号引用来源编号，例如 [S1]。只允许引用实际提供的编号。",
      "区分作者原文、用户当时的点评、后来形成的观点、读完结案和回顾后的新想法。",
      "若材料不足，明确说明证据不足，将 evidenceState 设为 partial 或 none；不要为了显得完整而推测用户人格或立场。",
      "使用简洁、成熟的中文，优先指出材料之间的一致、变化、分歧或尚未回答的问题。"
    ].join("\n"),
    input: JSON.stringify({ question, sources }),
    text: {
      format: {
        type: "json_schema",
        name: "reading_archive_answer",
        strict: true,
        schema: responseSchema()
      }
    },
    max_output_tokens: 1400
  };
}

function outputText(payload) {
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal" && content.refusal) throw new OpenAIProviderError(content.refusal, "REFUSAL");
    }
  }
  throw new OpenAIProviderError(payload.status === "incomplete" ? "AI 回答未完成，请缩短问题后重试" : "AI 没有返回可用文本", "EMPTY_OUTPUT");
}

export async function askOpenAI({ apiKey, question, sources, model = DEFAULT_MODEL, fetchImpl = fetch }) {
  if (!validOpenAIKey(apiKey)) throw new OpenAIProviderError("OpenAI API Key 格式不正确", "INVALID_KEY");
  if (!String(question || "").trim()) throw new OpenAIProviderError("问题不能为空", "INVALID_QUESTION");
  if (!Array.isArray(sources) || !sources.length) throw new OpenAIProviderError("没有可用于回答的档案来源", "NO_SOURCES");
  const safeSources = sources.slice(0, 12).map((source, index) => ({
    ref: `S${index + 1}`,
    type: String(source.type || "unknown").slice(0, 32),
    title: String(source.title || "").slice(0, 160),
    bookTitle: String(source.bookTitle || "").slice(0, 160),
    text: String(source.text || "").slice(0, 700),
    date: String(source.date || "").slice(0, 40)
  }));
  const response = await fetchImpl(RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildArchiveRequest({ question: String(question).slice(0, 1000), sources: safeSources, model }))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new OpenAIProviderError(payload.error?.message || `OpenAI API 返回 ${response.status}`, payload.error?.code || "HTTP_ERROR");
  let parsed;
  try { parsed = JSON.parse(outputText(payload)); } catch (error) {
    if (error instanceof OpenAIProviderError) throw error;
    throw new OpenAIProviderError("AI 返回内容无法解析", "INVALID_OUTPUT");
  }
  const allowed = new Set(safeSources.map((source) => source.ref));
  const citations = [...new Set((parsed.citations || []).filter((ref) => allowed.has(ref)))];
  const answer = String(parsed.answer || "").replace(/\[(S\d+)\]/g, (match, ref) => allowed.has(ref) ? match : "");
  return {
    answer,
    citations,
    evidenceState: ["sufficient", "partial", "none"].includes(parsed.evidenceState) ? parsed.evidenceState : "partial",
    followUps: (parsed.followUps || []).map(String).slice(0, 3),
    model,
    provider: "openai"
  };
}

export { DEFAULT_MODEL, RESPONSES_URL };
