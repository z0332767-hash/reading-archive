import test from "node:test";
import assert from "node:assert/strict";
import { filterBooks, makeIdeaFromAnnotation, mergeArchive, normalizeArchive, previewMerge, selectReviewItems, stableHash, toMarkdown, upgradeArchiveShape } from "../core.mjs";
import { demoArchive } from "../data.js";

const empty = { books: [], annotations: [], reflections: [] };
const payload = {
  books: [{ id: "b1", title: "测试之书", author: "某作者", status: "finished", tags: ["记忆"] }],
  annotations: [{ bookId: "b1", chapter: "第一章", originalText: "同一句划线", comment: "我的点评" }]
};

test("stableHash 对多余空白不敏感", () => {
  assert.equal(stableHash("同一  句话"), stableHash("同一 句话"));
});

test("normalizeArchive 生成稳定的笔记哈希", () => {
  const first = normalizeArchive(payload);
  const second = normalizeArchive(payload);
  assert.equal(first.annotations[0].contentHash, second.annotations[0].contentHash);
  assert.equal(first.books[0].progress, 0);
});

test("重复导入不会新增相同记录", () => {
  const incoming = normalizeArchive(payload);
  const firstPreview = previewMerge(empty, incoming);
  const current = mergeArchive(empty, firstPreview);
  const secondPreview = previewMerge(current, incoming);
  assert.equal(secondPreview.newBooks.length, 0);
  assert.equal(secondPreview.newAnnotations.length, 0);
  assert.equal(secondPreview.duplicateBooks.length, 1);
  assert.equal(secondPreview.duplicateAnnotations.length, 1);
});

test("同名同作者的微信读书记录合并到手工书籍并重映射笔记", () => {
  const current = normalizeArchive({ books: [{ id: "manual-1", title: "同一本书", author: "同一作者", progress: 10 }], annotations: [] });
  const incoming = normalizeArchive({
    books: [{ id: "weread-1", title: "同一本书", author: "同一作者", progress: 80, source: "weread", sourceBookId: "wx1" }],
    annotations: [{ bookId: "weread-1", originalText: "新划线", source: "weread", sourceAnnotationId: "mark1" }]
  });
  const preview = previewMerge(current, incoming);
  assert.equal(preview.newBooks.length, 0);
  assert.equal(preview.updatedBooks.length, 1);
  assert.equal(preview.newAnnotations[0].bookId, "manual-1");
  const merged = mergeArchive(current, preview);
  assert.equal(merged.books[0].progress, 80);
  assert.equal(merged.books[0].id, "manual-1");
});

test("导出的示例档案重新导入时会完整去重", () => {
  const importedBackup = normalizeArchive(JSON.parse(JSON.stringify(demoArchive)));
  const preview = previewMerge(demoArchive, importedBackup);
  assert.equal(preview.newBooks.length, 0);
  assert.equal(preview.newAnnotations.length, 0);
});

test("全文搜索覆盖书籍和笔记", () => {
  const archive = normalizeArchive(payload);
  assert.equal(filterBooks(archive.books, archive.annotations, "点评", "", "").length, 1);
  assert.equal(filterBooks(archive.books, archive.annotations, "", "finished", "记忆").length, 1);
  assert.equal(filterBooks(archive.books, archive.annotations, "不存在", "", "").length, 0);
});

test("Markdown 导出区分原文和个人点评", () => {
  const markdown = toMarkdown(normalizeArchive(payload));
  assert.match(markdown, /> 同一句划线/);
  assert.match(markdown, /我的点评：我的点评/);
});

test("无效数据给出可定位的错误", () => {
  assert.throws(() => normalizeArchive({ books: [{ author: "没有标题" }] }), /第 1 本书缺少 title/);
});

test("旧版档案升级时补全思想与回顾数据结构", () => {
  const upgraded = upgradeArchiveShape({ version: 1, books: [{ id: "b1" }], annotations: [] });
  assert.equal(upgraded.version, 4);
  assert.deepEqual(upgraded.ideas, []);
  assert.deepEqual(upgraded.reviewRecords, []);
  assert.deepEqual(upgraded.bookClosures, {});
  assert.deepEqual(upgraded.askHistory, []);
});

test("Today 不重复选择七天内刚回顾的内容", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const archive = {
    annotations: [
      { id: "old", originalText: "很久未回顾", comment: "重要", tags: [], organized: true },
      { id: "recent", originalText: "刚回顾", comment: "", tags: [], organized: false }
    ],
    reviewRecords: [{ id: "r1", annotationId: "recent", reviewedAt: "2026-08-31T12:00:00.000Z" }]
  };
  const selected = selectReviewItems(archive, 3, now);
  assert.deepEqual(selected.map((item) => item.annotation.id), ["old"]);
});

test("Inbox 洞见可转化为带来源的观点", () => {
  const idea = makeIdeaFromAnnotation({ id: "a1", bookId: "b1", originalText: "原文", comment: "记录会替代经验。", reflectionType: "insight" }, { title: "某书" }, "2026-09-01T00:00:00.000Z");
  assert.equal(idea.type, "claim");
  assert.equal(idea.title, "记录会替代经验");
  assert.equal(idea.sourceTitle, "某书");
});

test("完整备份恢复观点、回顾记录与读完结案页", () => {
  const backup = normalizeArchive({
    books: [{ id: "b1", title: "书", author: "作者" }],
    annotations: [{ id: "a1", bookId: "b1", originalText: "原文" }],
    ideas: [{ id: "i1", type: "claim", title: "观点", bookId: "b1" }],
    reviewRecords: [{ id: "r1", annotationId: "a1", response: "agree" }],
    bookClosures: { b1: { bookId: "b1", oneSentence: "结论" } },
    askHistory: [{ id: "q1", question: "我怎么看？", evidenceState: "partial" }]
  });
  const preview = previewMerge(upgradeArchiveShape({}), backup);
  const restored = mergeArchive(upgradeArchiveShape({}), preview);
  assert.equal(restored.ideas.length, 1);
  assert.equal(restored.reviewRecords.length, 1);
  assert.equal(restored.bookClosures.b1.oneSentence, "结论");
  assert.equal(restored.askHistory[0].question, "我怎么看？");
});
