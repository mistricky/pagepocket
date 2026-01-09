import { isTextResponse } from "../content-type";
import type { CaptureHacker } from "./types";

export const captureNetworkRecorder: CaptureHacker = {
  id: "capture-network-recorder",
  stage: "capture",
  apply: async ({ page, networkRecords }) => {
    await page.setRequestInterception(true);

    page.on("request", (request) => {
      request.continue().catch(() => undefined);
    });

    page.on("response", async (response) => {
      const request = response.request();
      const url = response.url();
      const headers = response.headers();
      const requestHeaders = request.headers();
      const requestBody = request.postData() || "";

      // Capture the response body while preserving encoding for replay.
      const { responseBody, responseBodyBase64, responseEncoding, error } = await (async () => {
        try {
          const buffer = await response.buffer();
          const contentType = headers["content-type"] || "";

          if (isTextResponse(contentType)) {
            return {
              responseBody: buffer.toString("utf-8"),
              responseBodyBase64: undefined,
              responseEncoding: "text" as const,
              error: undefined
            };
          }

          return {
            responseBody: undefined,
            responseBodyBase64: buffer.toString("base64"),
            responseEncoding: "base64" as const,
            error: undefined
          };
        } catch (err: any) {
          return {
            responseBody: undefined,
            responseBodyBase64: undefined,
            responseEncoding: undefined,
            error: String(err)
          };
        }
      })();

      networkRecords.push({
        url,
        method: request.method(),
        requestHeaders,
        requestBody,
        status: response.status(),
        statusText: response.statusText(),
        responseHeaders: headers,
        responseBody,
        responseBodyBase64,
        responseEncoding,
        error,
        timestamp: Date.now()
      });
    });
  }
};
