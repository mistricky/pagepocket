import { describe, expect, it, vi } from "vitest";

import { Lighterceptor } from "../src/index";

describe("Lighterceptor run", () => {
  it("writes requests for html input", async () => {
    const lighterceptor = new Lighterceptor(`<img src="https://example.com/a.png">`, {
      requestOnly: true
    });

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("a.png"))).toBe(true);
  });

  it("writes requests for js input", async () => {
    const lighterceptor = new Lighterceptor(
      `<script src="https://example.com/app.js"></script><script>fetch("https://example.com/api");</script>`,
      { requestOnly: true }
    );

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("api"))).toBe(true);
    expect(result.requests.some((item) => item.url.includes("app.js"))).toBe(true);
  });

  it("writes requests for css input", async () => {
    const lighterceptor = new Lighterceptor(
      `<style>.hero { background-image: url("https://example.com/bg.png"); }</style>`,
      { requestOnly: true }
    );

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("bg.png"))).toBe(true);
  });

  it("records response details when requestOnly is false", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("hello from mock", {
        status: 200,
        headers: {
          "content-type": "text/plain"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const lighterceptor = new Lighterceptor(`<img src="https://example.com/a.png">`);
      const result = await lighterceptor.run();
      const record = result.networkRecords?.find((item) => item.url.includes("a.png"));

      expect(record?.response?.status).toBe(200);
      expect(record?.response?.body).toContain("hello from mock");
      expect(record?.response?.bodyEncoding).toBe("text");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("encodes binary responses as base64", async () => {
    const payload = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const fetchMock = vi.fn(async () => {
      return new Response(payload, {
        status: 200,
        headers: {
          "content-type": "image/png"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const lighterceptor = new Lighterceptor(`<img src="https://example.com/a.png">`);
      const result = await lighterceptor.run();
      const record = result.networkRecords?.find((item) => item.url.includes("a.png"));

      expect(record?.response?.bodyEncoding).toBe("base64");
      expect(record?.response?.body).toBe(Buffer.from(payload).toString("base64"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats url input as baseUrl and fetches html", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://example.com/page") {
        return new Response('<img src="/a.png">', {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        });
      }
      if (url === "https://example.com/a.png") {
        return new Response("image-bytes", {
          status: 200,
          headers: {
            "content-type": "image/png"
          }
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await new Lighterceptor("https://example.com/page").run();
      const urls = result.requests.map((item) => item.url);
      expect(urls).toContain("https://example.com/a.png");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
