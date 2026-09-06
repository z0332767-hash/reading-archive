import test from "node:test";
import assert from "node:assert/strict";
import { askOpenAI, buildArchiveRequest, RESPONSES_URL } from "../openai-provider.mjs";

const sources = [{ ref: "X9", type: "comment", title: "我的点评", bookTitle: "书", text: "这是证据" }];

test("Responses API 请求启用结构化输出且不保存响应", () => {
  const body = buildArchiveRequest({ question: "问题", sources });
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
});

test("模型回答解析后过滤不存在的引用", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return { output: [{ content: [{ type: "output_text", text: JSON.stringify({ answer: "结论 [S1]，错误 [S9]", citations: ["S1", "S9"], evidenceState: "sufficient", followUps: ["继续吗？"] }) }] }] };
      }
    };
  };
  const result = await askOpenAI({ apiKey: "sk-abcdefghijklmnop", question: "问题", sources, fetchImpl });
  assert.equal(request.url, RESPONSES_URL);
  assert.match(request.options.headers.Authorization, /^Bearer sk-/);
  assert.doesNotMatch(request.options.body, /sk-abcdefghijklmnop/);
  assert.deepEqual(result.citations, ["S1"]);
  assert.equal(result.answer, "结论 [S1]，错误 ");
});

test("发送前重排来源编号并限制为十二条", async () => {
  let sent;
  const manySources = Array.from({ length: 15 }, (_, index) => ({ ref: `X${index}`, type: "idea", title: "标题", text: "正文" }));
  const fetchImpl = async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, async json() { return { output: [{ content: [{ type: "output_text", text: JSON.stringify({ answer: "有证据 [S1]", citations: ["S1"], evidenceState: "partial", followUps: [] }) }] }] }; } };
  };
  await askOpenAI({ apiKey: "sk-abcdefghijklmnop", question: "问题", sources: manySources, fetchImpl });
  const parsedInput = JSON.parse(sent.input);
  assert.equal(parsedInput.sources.length, 12);
  assert.equal(parsedInput.sources[0].ref, "S1");
  assert.equal(parsedInput.sources[11].ref, "S12");
});
