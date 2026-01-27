import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { matchAPI } from "../src/replay-script";

const makeRecord = (input: {
  url: string;
  method: string;
  requestBody?: string;
  requestBodyBase64?: string;
  timestamp?: number;
}) => ({
  url: input.url,
  method: input.method,
  requestBody: input.requestBody,
  requestBodyBase64: input.requestBodyBase64,
  timestamp: input.timestamp ?? 1
});

describe("matchAPI", () => {
  test("matches exact method/url/body", () => {
    const record = makeRecord({
      url: "https://example.com/api/data?x=1",
      method: "POST",
      requestBody: "a=1"
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://example.com/base/",
      method: "POST",
      url: "https://example.com/api/data?x=1",
      body: "a=1"
    });
    assert.equal(result, record);
  });

  test("falls back to empty body match", () => {
    const record = makeRecord({
      url: "https://example.com/api/data",
      method: "POST",
      requestBody: ""
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://example.com/",
      method: "POST",
      url: "https://example.com/api/data",
      body: "a=2"
    });
    assert.equal(result, record);
  });

  test("falls back to GET when method differs", () => {
    const record = makeRecord({
      url: "https://example.com/api/data",
      method: "GET"
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://example.com/",
      method: "POST",
      url: "https://example.com/api/data",
      body: ""
    });
    assert.equal(result, record);
  });

  test("matches by path+query when origin differs", () => {
    const record = makeRecord({
      url: "https://api.example.com/v1/items?id=1",
      method: "GET"
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://api.example.com/",
      method: "GET",
      url: "http://localhost:8080/v1/items?id=1",
      body: undefined
    });
    assert.equal(result, record);
  });

  test("matches by pathname when origin differs", () => {
    const record = makeRecord({
      url: "https://ciechanow.ski/models/moon_eph.dat",
      method: "GET"
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://ciechanow.ski/moon/",
      method: "GET",
      url: "http://localhost:8080/models/moon_eph.dat",
      body: undefined
    });
    assert.equal(result, record);
  });

  test("prefers exact body match over empty fallback", () => {
    const emptyBody = makeRecord({
      url: "https://example.com/api/submit",
      method: "POST",
      requestBody: ""
    });
    const exactBody = makeRecord({
      url: "https://example.com/api/submit",
      method: "POST",
      requestBody: "a=1"
    });
    const result = matchAPI({
      records: [emptyBody, exactBody],
      baseUrl: "https://example.com/",
      method: "POST",
      url: "https://example.com/api/submit",
      body: "a=1"
    });
    assert.equal(result, exactBody);
  });

  test("returns undefined when no fallback matches", () => {
    const record = makeRecord({
      url: "https://example.com/api/data",
      method: "GET"
    });
    const result = matchAPI({
      records: [record],
      baseUrl: "https://example.com/",
      method: "POST",
      url: "https://example.com/api/other",
      body: "x=1"
    });
    assert.equal(result, undefined);
  });
});
