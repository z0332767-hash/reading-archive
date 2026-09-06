import test from "node:test";
import assert from "node:assert/strict";
import { buildTopicMap, buildTopicTimeline, relatedTopics } from "../map.mjs";

const archive = {
  books: [
    { id: "b1", title: "书一", tags: ["记忆", "城市"], summary: "关于记忆", startedAt: "2025-01-01" },
    { id: "b2", title: "书二", tags: ["记忆", "摄影"], summary: "摄影与记忆", startedAt: "2026-01-01" }
  ],
  annotations: [{ id: "a1", bookId: "b1", tags: ["记忆", "记录"], originalText: "记忆会变化", comment: "我不再相信记录等于保存", sourceCreatedAt: "2025-01-02", type: "comment" }],
  ideas: [{ id: "i1", annotationId: "a1", bookId: "b1", type: "claim", title: "记忆不是容器", content: "它会被重写", createdAt: "2025-01-03" }],
  bookClosures: { b1: { changed: "重新理解记忆", completedAt: "2025-01-10" } },
  reviewRecords: [{ id: "r1", annotationId: "a1", response: "changed", thought: "现在更在意重构", reviewedAt: "2026-02-01" }]
};

test("主题地图统计跨书主题并生成关系", () => {
  const map = buildTopicMap(archive);
  const memory = map.topics.find((topic) => topic.name === "记忆");
  assert.equal(memory.books.length, 2);
  assert.ok(map.edges.some((edge) => [edge.source, edge.target].includes("记忆")));
});

test("关联主题按共同出现强度返回", () => {
  const related = relatedTopics(buildTopicMap(archive), "记忆");
  assert.ok(related.some((topic) => topic.name === "城市"));
  assert.ok(related.some((topic) => topic.name === "摄影"));
});

test("主题时间线按时间排列并标出观点修正", () => {
  const timeline = buildTopicTimeline(archive, "记忆");
  assert.ok(timeline.length >= 5);
  assert.equal(timeline.at(-1).stage, "revision");
  assert.deepEqual([...timeline].sort((a, b) => a.date.localeCompare(b.date)).map((item) => item.id), timeline.map((item) => item.id));
});
