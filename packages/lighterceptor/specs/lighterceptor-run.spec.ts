import { describe, expect, it, vi } from "vitest";

import { Lighterceptor } from "../src/index";

describe("Lighterceptor run", () => {
  const runWithConsoleSpy = async (html: string) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lighterceptor = new Lighterceptor(html, { requestOnly: true });
      await lighterceptor.run();
    } finally {
      spy.mockRestore();
    }
    return spy;
  };

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

  it("captures Image src set via inline script variable", async () => {
    const lighterceptor = new Lighterceptor(
      `<html><script>
const foo = new Image();
const url = "https://example.com/variable-image.png";
foo.src = url;
</script></html>`,
      { requestOnly: true }
    );

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("variable-image.png"))).toBe(true);
  });

  it("captures Image src set via inline script template string", async () => {
    const lighterceptor = new Lighterceptor(
      `<html><script>
const foo = new Image();
const name = "template-image";
foo.src = \`https://example.com/\${name}.png\`;
</script></html>`,
      { requestOnly: true }
    );

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("template-image.png"))).toBe(true);
  });

  it("captures Image src set via inline script concatenation", async () => {
    const lighterceptor = new Lighterceptor(
      `<html><script>
const foo = new Image();
const base = "https://example.com/";
const path = "concat-image.png";
foo.src = base + path;
</script></html>`,
      { requestOnly: true }
    );

    const result = await lighterceptor.run();
    expect(result.requests.some((item) => item.url.includes("concat-image.png"))).toBe(true);
  });

  it("captures Image src set via external script", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://example.com/app.js") {
        return new Response(
          `
const foo = new Image();
foo.src = "https://example.com/external-image.png";
`,
          {
            status: 200,
            headers: {
              "content-type": "text/javascript"
            }
          }
        );
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const lighterceptor = new Lighterceptor(
        `<html><script src="https://example.com/app.js"></script></html>`,
        { requestOnly: true, recursion: true }
      );

      const result = await lighterceptor.run();
      expect(result.requests.some((item) => item.url.includes("external-image.png"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not error when scripts call fetch().json()", async () => {
    const spy = await runWithConsoleSpy(`<!doctype html>
<script>
fetch("https://example.com/api")
  .then((res) => res.json())
  .then(() => {});
</script>`);
    expect(spy.mock.calls.length).toBe(0);
  });

  it("does not error when scripts call fetch().text()", async () => {
    const spy = await runWithConsoleSpy(`<!doctype html>
<script>
fetch("https://example.com/api")
  .then((res) => res.text())
  .then(() => {});
</script>`);
    expect(spy.mock.calls.length).toBe(0);
  });

  it("does not error when scripts call fetch().arrayBuffer()", async () => {
    const spy = await runWithConsoleSpy(`<!doctype html>
<script>
fetch("https://example.com/api")
  .then((res) => res.arrayBuffer())
  .then(() => {});
</script>`);
    expect(spy.mock.calls.length).toBe(0);
  });

  it("does not error when scripts call fetch().clone()", async () => {
    const spy = await runWithConsoleSpy(`<!doctype html>
<script>
fetch("https://example.com/api").then((res) => {
  const cloned = res.clone();
  return cloned.text();
});
</script>`);
    expect(spy.mock.calls.length).toBe(0);
  });
});
