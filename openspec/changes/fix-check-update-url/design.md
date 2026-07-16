## 修复方案

### 根因

`src/lib/version.ts` 中 `GITHUB_REPO` 硬编码为 `ding113/claude-code-hub`，导致部署到其他仓库的实例版本检查 URL 指向错误的仓库。

### 修复

将 `GITHUB_REPO` 改为支持环境变量覆盖：

```typescript
export const GITHUB_REPO = {
  owner: process.env.NEXT_PUBLIC_GITHUB_OWNER || "ding113",
  repo: process.env.NEXT_PUBLIC_GITHUB_REPO || "claude-code-hub",
};
```

`NEXT_PUBLIC_` 前缀确保环境变量在客户端可用（虽然当前仅在 API route 中使用，但保持一致性）。

### 测试

- 无环境变量时行为不变（`ding113/claude-code-hub`）
- 设置环境变量后使用自定义仓库地址