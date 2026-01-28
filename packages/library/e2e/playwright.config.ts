const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: {
    timeout: 20_000
  },
  reporter: [["list"]]
});
