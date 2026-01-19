import { VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";

import { createJSDOMWithInterceptor } from "../src/dom";

const runWithDomErrors = async (html: string) => {
  const errors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    errors.push(error);
  });

  createJSDOMWithInterceptor({
    html,
    domOptions: {
      runScripts: "dangerously",
      virtualConsole
    },
    interceptor: async () => Buffer.from("")
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  return errors;
};

describe("createJSDOMWithInterceptor", () => {
  it("does not emit jsdom errors when scripts touch matchMedia or canvas APIs", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<script>
CanvasRenderingContext2D.prototype.roundRect = function() {};
window.matchMedia("(min-width: 1px)").matches;
</script>`);
    expect(errors).toHaveLength(0);
  });

  it("does not emit jsdom errors when scripts request a 2d canvas context", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<canvas id="chart"></canvas>
<script>
CanvasRenderingContext2D.prototype.roundRect = function() {};
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");
ctx.roundRect(0, 0, 1, 1, 1);
</script>`);
    expect(errors).toHaveLength(0);
  });

  it("does not emit jsdom errors when scripts request a webgl context", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<canvas id="gl"></canvas>
<script>
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl");
gl.getExtension("OES_element_index_uint");
</script>`);
    expect(errors).toHaveLength(0);
  });

  it("does not emit jsdom errors when shaders read info logs", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<canvas id="gl"></canvas>
<script>
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl");
const log = gl.getShaderInfoLog(gl.createShader(gl.VERTEX_SHADER));
log.length;
</script>`);
    expect(errors).toHaveLength(0);
  });

  it("installs jsdom-testing-mocks API shims", () => {
    const dom = createJSDOMWithInterceptor({
      html: "<!doctype html><div></div>",
      domOptions: {
        runScripts: "dangerously"
      },
      interceptor: async () => Buffer.from("")
    });

    const { window } = dom;
    expect(typeof window.matchMedia).toBe("function");
    expect(typeof window.IntersectionObserver).toBe("function");
    expect(typeof window.IntersectionObserverEntry).toBe("function");
    expect(typeof window.ResizeObserver).toBe("function");
    expect(typeof window.Element.prototype.animate).toBe("function");
    expect(typeof (window as { CSS?: unknown }).CSS).toBe("object");
    expect(typeof (window as { CSS?: { px?: unknown } }).CSS?.px).toBe("function");

    const io = new window.IntersectionObserver(() => {});
    io.observe(window.document.body);
    const ro = new window.ResizeObserver(() => {});
    ro.observe(window.document.body);
    const mediaMatches = window.matchMedia("(min-width: 1px)").matches;
    expect(typeof mediaMatches).toBe("boolean");
  });

  it("emits jsdom errors from DOMContentLoaded handlers", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<script>
document.addEventListener("DOMContentLoaded", () => {
  const oops = undefined;
  oops.load();
});
</script>`);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("emits jsdom errors from load handlers", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<script>
window.addEventListener("load", () => {
  const oops = undefined;
  oops.load();
});
window.dispatchEvent(new Event("load"));
</script>`);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("dispatches hover events after load", async () => {
    const html = `<!doctype html>
<div id="target"></div>
<script>
window.__hovered = false;
document.getElementById("target").addEventListener("mouseover", () => {
  window.__hovered = true;
});
</script>`;
    const dom = createJSDOMWithInterceptor({
      html,
      domOptions: {
        runScripts: "dangerously"
      },
      interceptor: async () => Buffer.from("")
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((dom.window as { __hovered?: boolean }).__hovered).toBe(true);
  });
});
