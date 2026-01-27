import { uniFetch } from "../src/index";

async function run() {
  const response = await uniFetch("https://www.npmjs.com/");
  const body = await response.text();

  console.log("Status:", response.status);
  console.log("Body preview:", body.slice(0, 200));
}

void run();
