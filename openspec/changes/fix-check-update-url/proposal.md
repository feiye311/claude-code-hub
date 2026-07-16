## Why

系统检查更新功能（`/api/version`）硬编码了 GitHub 仓库地址为 `ding113/claude-code-hub`，但用户实际部署的仓库不是这个地址。需要支持通过环境变量配置仓库地址。

## What Changes

- `src/lib/version.ts`：`GITHUB_REPO` 改从环境变量 `NEXT_PUBLIC_GITHUB_OWNER` / `NEXT_PUBLIC_GITHUB_REPO` 读取，保留硬编码作为默认值
- 环境变量文档（`.env.example` 等）

## Capabilities

### New Capabilities
- `github-repo-config`: 通过环境变量自定义 GitHub 仓库地址，用于版本检查功能

### Modified Capabilities
- 无

## Impact

- `src/lib/version.ts`：单个文件修改
- `.env.example`：添加环境变量说明