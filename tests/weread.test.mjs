import test from "node:test";
import assert from "node:assert/strict";
import { createWeReadClient, fetchAllNotebooks, fetchAllReviews, mapWeReadAnnotations, mapWeReadBook, syncWeRead } from "../weread.mjs";

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("官方网关请求把业务参数平铺在顶层且不泄露 Key 到 body", async () => {
  let captured;
  const call = createWeReadClient("wrk-test_key", async (_url, options) => {
    captured = options;
    return jsonResponse({ books: [] });
  });
  await call("/user/notebooks", { count: 20, lastSort: 123 });
  const body = JSON.parse(captured.body);
  assert.equal(body.api_name, "/user/notebooks");
  assert.equal(body.count, 20);
  assert.equal(body.lastSort, 123);
  assert.equal(body.params, undefined);
  assert.equal(captured.body.includes("wrk-test_key"), false);
  assert.equal(captured.headers.Authorization, "Bearer wrk-test_key");
});

test("笔记本概览按 lastSort 完整分页", async () => {
  const requests = [];
  const call = async (_api, params) => {
    requests.push(params);
    if (!params.lastSort) return { books: [{ bookId: "a", sort: 99 }], hasMore: 1, totalBookCount: 2, totalNoteCount: 5 };
    return { books: [{ bookId: "b", sort: 50 }], hasMore: 0, totalBookCount: 2, totalNoteCount: 5 };
  };
  const result = await fetchAllNotebooks(call);
  assert.deepEqual(result.books.map((book) => book.bookId), ["a", "b"]);
  assert.equal(requests[1].lastSort, 99);
  assert.equal(result.totalNoteCount, 5);
});

test("个人想法按 synckey 完整分页", async () => {
  const keys = [];
  const call = async (_api, params) => {
    keys.push(params.synckey);
    if (!params.synckey) return { reviews: [{ review: { reviewId: "r1" } }], hasMore: 1, synckey: 88 };
    return { reviews: [{ review: { reviewId: "r2" } }], hasMore: 0, synckey: 99 };
  };
  const reviews = await fetchAllReviews(call, "book-1");
  assert.deepEqual(keys, [0, 88]);
  assert.equal(reviews.length, 2);
});

test("微信读书书籍映射保留来源、进度和状态", () => {
  const book = mapWeReadBook({
    bookId: "book-1",
    book: { bookId: "book-1", title: "测试书", author: "作者", category: "文学", cover: "https://example.test/cover" },
    readingProgress: 100,
    markedStatus: 1,
    sort: 1770000000
  });
  assert.equal(book.id, "weread_book-1");
  assert.equal(book.status, "finished");
  assert.equal(book.progress, 100);
  assert.equal(book.source, "weread");
});

test("带想法的划线合并为原文加点评，无原文想法作为个人笔记", () => {
  const notes = mapWeReadAnnotations("book-1", {
    chapters: [{ chapterUid: 1, title: "第一章" }],
    updated: [
      { bookmarkId: "m1", chapterUid: 1, range: "1-5", markText: "有想法的原文", createTime: 1770000000 },
      { bookmarkId: "m2", chapterUid: 1, range: "6-9", markText: "只有划线", createTime: 1770000100 }
    ]
  }, [
    { review: { reviewId: "r1", chapterUid: 1, range: "1-5", abstract: "有想法的原文", content: "我的想法", createTime: 1770000200 } },
    { review: { reviewId: "r2", content: "全书点评", createTime: 1770000300 } }
  ]);
  assert.equal(notes.length, 3);
  assert.equal(notes.find((note) => note.id === "weread_review_r1").comment, "我的想法");
  assert.equal(notes.find((note) => note.id === "weread_review_r2").type, "note");
  assert.equal(notes.some((note) => note.id === "weread_mark_m1"), false);
  assert.equal(notes.some((note) => note.id === "weread_mark_m2"), true);
});

test("完整同步只调用只读接口并返回可导入档案", async () => {
  const apiNames = [];
  const fakeFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    apiNames.push(request.api_name);
    if (request.api_name === "/user/notebooks") return jsonResponse({ books: [{ bookId: "b1", book: { bookId: "b1", title: "书一", author: "作者" }, readingProgress: 50, sort: 99 }], hasMore: 0, totalBookCount: 1, totalNoteCount: 1 });
    if (request.api_name === "/book/bookmarklist") return jsonResponse({ updated: [{ bookmarkId: "m1", bookId: "b1", markText: "划线", chapterUid: 1 }], chapters: [{ chapterUid: 1, title: "章节" }] });
    if (request.api_name === "/review/list/mine") return jsonResponse({ reviews: [], hasMore: 0 });
    throw new Error(`unexpected ${request.api_name}`);
  };
  const result = await syncWeRead({ apiKey: "wrk-test_key", fetchImpl: fakeFetch });
  assert.deepEqual(apiNames, ["/user/notebooks", "/book/bookmarklist", "/review/list/mine"]);
  assert.equal(result.books.length, 1);
  assert.equal(result.annotations.length, 1);
});
