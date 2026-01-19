import { describe, expect, it } from "vitest";

import { createJSDOMWithInterceptor } from "../src/index";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("img src interception", () => {
  it("intercepts image resource requests", async () => {
    const seen: string[] = [];

    const dom = createJSDOMWithInterceptor({
      html: `<body></body>`,
      domOptions: {
        pretendToBeVisual: true
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    const img = dom.window.document.createElement("img");
    img.src = "https://example.com/a.png";
    dom.window.document.body.appendChild(img);

    await wait(100);

    expect(seen).toContain("https://example.com/a.png");
  });

  it("intercepts Image() src assignments", async () => {
    const seen: string[] = [];

    const dom = createJSDOMWithInterceptor({
      html: `<body></body>`,
      domOptions: {
        pretendToBeVisual: true
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    const image = new dom.window.Image();
    image.src = "https://example.com/image.png";

    await wait(100);

    expect(seen).toContain("https://example.com/image.png");
  });

  it("intercepts Image() src assignments from inline scripts", async () => {
    const seen: string[] = [];

    createJSDOMWithInterceptor({
      html: `<html><script>
const foo = new Image();
foo.src = "https://example.com/script-image.png";
</script></html>`,
      domOptions: {
        pretendToBeVisual: true,
        runScripts: "dangerously"
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    await wait(100);

    expect(seen).toContain("https://example.com/script-image.png");
  });

  it("intercepts Image() src assignments from inline scripts with variables", async () => {
    const seen: string[] = [];

    createJSDOMWithInterceptor({
      html: `<html><script>
const foo = new Image();
const url = "https://example.com/variable-image.png";
foo.src = url;
</script></html>`,
      domOptions: {
        pretendToBeVisual: true,
        runScripts: "dangerously"
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    await wait(100);

    expect(seen).toContain("https://example.com/variable-image.png");
  });

  it("intercepts Image() src assignments from inline scripts with template strings", async () => {
    const seen: string[] = [];

    createJSDOMWithInterceptor({
      html: `<html><script>
const foo = new Image();
const name = "template-image";
foo.src = \`https://example.com/\${name}.png\`;
</script></html>`,
      domOptions: {
        pretendToBeVisual: true,
        runScripts: "dangerously"
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    await wait(100);

    expect(seen).toContain("https://example.com/template-image.png");
  });

  it("intercepts Image() src assignments from inline scripts with concatenated strings", async () => {
    const seen: string[] = [];

    createJSDOMWithInterceptor({
      html: `<html><script>
const foo = new Image();
const base = "https://example.com/";
const path = "concat-image.png";
foo.src = base + path;
</script></html>`,
      domOptions: {
        pretendToBeVisual: true,
        runScripts: "dangerously"
      },
      interceptor: (url) => {
        seen.push(url);
        return Buffer.from("");
      }
    });

    await wait(100);

    expect(seen).toContain("https://example.com/concat-image.png");
  });
});
