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

  it("does not emit jsdom errors from DOMContentLoaded handlers", async () => {
    const errors = await runWithDomErrors(`<!doctype html>
<script>
document.addEventListener("DOMContentLoaded", () => {
  const oops = undefined;
  oops.load();
});
</script>`);
    expect(errors).toHaveLength(0);
  });
});
