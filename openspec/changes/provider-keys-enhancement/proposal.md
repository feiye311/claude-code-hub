## Why

当前上游 Provider 的多 Key 管理能力受限：Key 存储在 `providers.key: string[]` 数组中，缺乏独立的状态管理、权重配置和熔断控制。管理员无法单独禁用某个 Key、无法按权重分配流量、无法查看或手动恢复熔断的 Key。随着业务规模扩大，多 Key 负载均衡和精细化管理成为刚需。

## What Changes

- **新增 `provider_keys` 表**：独立的 Key 存储结构，支持权重、启用/禁用、熔断状态
- **负载均衡增强**：从"最少连接"改为"权重比"算法，按权重比例分配请求
- **Key 级熔断**：每个 Key 独立熔断，复用 Provider 级熔断参数
- **手动控制**：支持手动禁用 Key、手动恢复熔断 Key
- **前端 UI**：Provider 编辑表单内嵌 Key 列表管理（增删改权重、启用/禁用、熔断状态展示）
- **后台 API**：新增 Key 维度 CRUD 端点 + 手动恢复熔断端点

## Capabilities

### New Capabilities

- `provider-keys-management`: Provider 多 Key 管理（增删改查、权重配置、启用/禁用、熔断状态）
- `provider-keys-load-balancing`: 权重比负载均衡算法（按权重比例分配连接）
- `provider-keys-circuit-breaker`: Key 级熔断（复用 Provider 级参数）+ 手动恢复

### Modified Capabilities

（无现有 specs 需修改）

## Impact

- **数据模型**：新增 `provider_keys` 表，迁移现有 `providers.key: string[]` 数据
- **API 层**：`/api/v1/providers/{id}/keys` 新增 CRUD 端点
- **前端 UI**：`src/app/[locale]/dashboard/settings/providers/` Provider 编辑表单
- **负载均衡逻辑**：`src/lib/api-key-circuit.ts` 权重比算法替换最少连接
- **熔断逻辑**：`src/lib/circuit-breaker.ts` 新增 Key 级熔断状态管理