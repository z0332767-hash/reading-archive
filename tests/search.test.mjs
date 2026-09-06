import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchDocuments, composeLocalAnswer, prepareSources, searchArchive } from "../search.mjs";

const archive = {
  books: [{ id: "b1", title: "记忆之书", author: "作者甲", summary: "讨论记忆与记录", tags: ["记忆"] }],
  annotations: [
    { id: "a1", bookId: "b1", chapter: "第一章", originalText: "记忆不是静止的容器", comment: "我曾经把记录当作记忆的替代品", type: "highlight", tags: [] },
    { id: "a2", bookId: "b1", chapter: "第二章", originalText: "后来我更相信回忆是一种重构", type: "note", tags: [] }
  ],
  ideas: [{ id: "i1", type: "question", status: "open", title: "记录会不会削弱体验？", content: "这个问题还没有回答", bookId: "b1" }],
  bookClosures: { b1: { oneSentence: "记忆依赖持续重写", changed: "我不再追求完整保存" } },
  reviewRecords: [{ id: "r1", annotationId: "a1", response: "changed", thought: "现在更重视回想时的重新解释" }]
};

test("统一索引覆盖全部阅读内容类型", () => {
  const types = new Set(buildSearchDocuments(archive).map((document) => document.type));
  assert.deepEqual(types, new Set(["book", "original", "comment", "reflection", "idea", "closure", "review"]));
});

test("只看我的话会排除书籍和作者原文", () => {
  const results = searchArchive(archive, "记忆", { scope: "mine" });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => !["book", "original"].includes(result.type)));
});

test("中文主题词能命中并优先返回相关档案", () => {
  const results = searchArchive(archive, "记忆 重构");
  assert.ok(results.length > 0);
  assert.match(`${results[0].title} ${results[0].body}`, /记忆|重构/);
});

test("本地回答只引用存在的来源", () => {
  const results = searchArchive(archive, "记忆");
  const answer = composeLocalAnswer("记忆", results);
  const allowed = new Set(prepareSources(results).map((source) => source.ref));
  assert.ok(answer.citations.every((citation) => allowed.has(citation)));
  assert.match(answer.answer, /\[S1\]/);
});

test("没有证据时明确返回 none", () => {
  const answer = composeLocalAnswer("完全不存在的主题", []);
  assert.equal(answer.evidenceState, "none");
  assert.deepEqual(answer.citations, []);
});

test("发送给模型的来源数量和片段长度受限", () => {
  const results = Array.from({ length: 20 }, (_, index) => ({ type: "idea", title: `来源${index}`, body: "字".repeat(900) }));
  const sources = prepareSources(results);
  assert.equal(sources.length, 12);
  assert.ok(sources.every((source) => source.text.length <= 701));
});
