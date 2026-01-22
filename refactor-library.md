# PagePocket 重构 Tech Spec（最终版）

## 1. 目标与范围

### 目标
- 将 `packages/pagepocket` 重命名为 `packages/cli`，保留 CLI 功能与行为一致。
- 新增 `packages/library`，提供可复用的离线 HTML “重放/改写”能力。
- `library` 的使用方式：
  ```ts
  import { PagePocket } from "@pagepocket/lib";

  const pagepocket = new PagePocket(htmlString, requestsJSON);
  const page = pagepocket.put();
  ```
- `put()` 执行流程：
  1) **Downloading resources file**（与 FS 交互，使用 `packages/uni-fs`；若缺方法需补充并覆盖三环境测试）
  2) **Hack HTML**
     - 注入 hackers（reply, repload）
     - 将下载资源在 JS/CSS/HTML 中的路径改为本地 URL（使用 `uni-fs.readAsURL`）
     - 复用原先 HTML rewrite 逻辑
  3) 返回 HTML 字符串

### 非目标
- 不改动 CLI 的产物形态（HTML、requests.json、资源目录仍按原来输出）。
- 不引入额外测试框架（沿用 `node:test` 风格）。

---

## 2. 现状梳理（CLI 阶段）

参考 `packages/pagepocket/src/cli.ts` 的 ora 阶段，当前整体流程为：

1. Fetching the target HTML（`fetchHtml`）
2. Capturing network requests（`captureNetwork`）
3. Preparing output paths（`prepareOutputPaths`）
4. Downloading resources（`downloadResources`）
5. Rewriting HTML links（`rewriteLinkHrefs`）
6. Preparing snapshot HTML（`buildSnapshotData` + `buildSnapshotHtml`）
7. Writing snapshot files（`writeSnapshotFiles`）

新的 `library` 只覆盖与 HTML 组装/改写相关能力（主要对应阶段 4–6）。

---

## 3. 目标结构与包拆分

### 包结构调整
- `packages/pagepocket` → `packages/cli`
  - 原 CLI 逻辑保留
  - 依赖新的 `@pagepocket/lib` 完成离线 HTML 处理
- 新增 `packages/library`
  - package name：`@pagepocket/lib`
  - 对外 API：`PagePocket`

### library 源码组织（平铺结构）
```
packages/library/src/
  index.ts
  pagepocket.ts
  download-resources.ts
  hack-html.ts
  rewrite-links.ts
  resources.ts
  css-rewrite.ts
  replay-script.ts
  preload.ts
  hackers/
    index.ts
    types.ts
    ...
  types.ts
```

> 不使用 `src/lib` 子目录，所有模块直接平铺在 `src/` 下。

---

## 4. Library API 设计

### PagePocket 构造
```ts
class PagePocket {
  constructor(htmlString: string, requestsJSON: SnapshotData | string, options?: PagePocketOptions)
}
```

- `htmlString`：原始 HTML。
- `requestsJSON`：来自 CLI 的 `requests.json` 内容（可传对象或 JSON 字符串）。
- `options`（可选）：
  - `assetsDirName?: string`（默认值与 CLI 一致）
  - `baseUrl?: string`（优先取 `requestsJSON.url`）

### put()
- 建议签名：`async put(): Promise<string>`
- 原因：资源下载与 FS 写入需要异步

---

## 5. `put()` 流程细化

### Step 1: Downloading resources file
目的：下载 HTML 中引用的资源文件，并落盘到可被 `uni-fs.readAsURL` 读取的路径中。

**主要逻辑：**
- 解析 HTML，抽取资源 URL（复用 `extractResourceUrls`）
- 对每个资源：
  - 确定输出路径（基于 hash 或原逻辑）
  - 使用 `fetch` 获取内容
  - 用 `uni-fs.write()` 写入
- 维护 `resourceMap: originalUrl -> localPath`
- 记录资源元信息（与 `SnapshotData.resources` 对齐）

**`uni-fs` 可能新增的方法：**
- `readText()` / `readBinary()`（用于后续改写 CSS/JS/HTML）
- `exists()` 或 `stat()`（防止重复写入）
- `resolvePath()`（如需统一路径）

**测试要求：**
- 每新增一个 `uni-fs` 方法，必须补充 **三环境测试**：
  - Node
  - Browser (OPFS)
  - Service Worker (OPFS)

---

### Step 2: Hack HTML
#### 2.1 注入 hackers（reply, repload）
- 复用当前 `buildReplayScript` / `buildPreloadScript` 机制
- 确认“reply/repload”对应当前 repo 内的 replay/preload 逻辑
- 注入策略：优先 `<head>`，否则注入到 root

#### 2.2 替换资源路径为本地 URL
- **目标：** 让所有 JS/CSS/HTML 内资源引用都变成本地 URL
- **手段：**
  - 对下载资源调用 `uni-fs.readAsURL()` 得到 `data:` URL（或 Node 路径）
  - 替换 HTML 中 URL 为本地 URL
  - 改写 CSS 中 `url(...)`
  - 改写 `<script type="module">` 内的 import specifier
- 这一步确保所有资源不走网络，直接走本地资源

#### 2.3 复用原 rewrite 逻辑
- 使用旧 `rewriteLinkHrefs` 的 URL → data-url 替换机制
- 维持对 `networkRecords` 的兼容

---

### Step 3: 返回 HTML
- 返回最终改写后的 HTML 字符串
- `library` 不负责写文件、也不负责生成 snapshot json（由 CLI 处理）

---

## 6. CLI 集成方式

### CLI 重构策略
- `packages/cli` 保持原有行为
- 关键改动：
  - 在资源下载 + HTML 改写阶段，改为调用 `@pagepocket/lib`
  - `new PagePocket(htmlString, requestsJSON).put()`

### 保留阶段
- `fetchHtml`
- `captureNetwork`
- `prepareOutputPaths`
- `buildSnapshotData`
- `writeSnapshotFiles`

---

## 7. 测试策略

### Library 测试重点
1. 资源下载与 `uni-fs.write` 的一致性  
2. HTML 资源 URL 替换（img/link/script/srcset）  
3. CSS 中 `url(...)` 替换  
4. JS module import 替换  
5. hackers 注入存在性与位置  
6. `requestsJSON` 解析兼容（string/object）  
7. 资源未命中时保留原 URL  

### uni-fs 测试要求
- 任何新增方法必须覆盖 **Node / Browser / Service Worker** 三环境
- 直接扩展 `packages/uni-fs/specs/uni-fs.test.ts`

---

## 8. 风险与注意事项

- `requestsJSON` 中 `networkRecords` 与 `resources` 的匹配逻辑不稳定时：
  - 优先使用 `resources` 的 `url -> localPath`
  - `networkRecords` 仅作为 data-url fallback
- `uni-fs.readAsURL` 在 Node 下目前返回 `/path` 形式（非 data-url）
  - 若需要统一行为，需修改并评估影响
- 资源替换顺序必须保证：
  1) 已下载资源
  2) `readAsURL` 可读
  3) 再写回 HTML/CSS/JS

---

## 9. 迁移步骤建议（实施顺序）

1. 重命名 `packages/pagepocket` → `packages/cli`
2. 新建 `packages/library`，定义 API
3. 将 `rewrite-links` / `hackers` / `resources` 等迁入 library（平铺结构）
4. 实现 `PagePocket.put()` 管线
5. CLI 改为依赖 `@pagepocket/lib`
6. 补齐 tests（library + uni-fs）
7. 跑 `pnpm run build / test / lint`
