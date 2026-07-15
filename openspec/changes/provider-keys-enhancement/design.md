## Context

当前 Provider 的多 Key 存储在 `providers.key: string[]` 数组中，`selectAvailableKey` 实现最少连接负载均衡 + Key 级熔断。但缺乏：
- 独立 Key 状态管理（启用/禁用、熔断状态持久化）
- 权重配置能力
- 前端可视化配置

本次设计引入独立 `provider_keys` 表，支持权重比负载均衡和精细化管理。

## Goals / Non-Goals

**Goals:**
- 独立 `provider_keys` 表存储 Key 元数据（权重、启用状态）
- 权重比负载均衡算法替换最少连接
- Key 级熔断状态管理 + 手动恢复
- 前端 Provider 编辑表单内嵌 Key 列表管理
- 后台 REST API 支持 Key CRUD + 手动恢复熔断

**Non-Goals:**
- 不修改 User Key（`keys` 表）
- 不实现 Key 级独立并发限制（由 Provider 级统一管控）
- 不实现 Key 级独立熔断参数（复用 Provider 级参数）

## Decisions

### D1: 数据模型 - 新建 provider_keys 表

**选择**: 独立表而非扩展 `providers.key` JSON 字段

**理由**:
- JSON 字段无法支持索引查询、外键约束和精细化状态管理
- 独立表支持 Key 级状态（熔断、启用）、权重、审计
- 便于未来扩展（如 Key 级并发限制、单独的熔断参数）

**Schema**:
```sql
CREATE TABLE provider_keys (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  key VARCHAR NOT NULL,
  name VARCHAR,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_provider_keys_provider_id ON provider_keys(provider_id);
```

### D2: 负载均衡 - 权重比算法

**选择**: 权重比算法替换最少连接

**理由**:
- 用户需求: key1 权重 1，key2 权重 2 - 连接比 1:2
- 算法: 维护每个 Key 的当前连接数，选择使 `当前连接数 / 权重` 最小的 Key
- 示例: key1 权重 1，当前连接 2；key2 权重 2，当前连接 3 - key1 比值 2，key2 比值 1.5 - 选 key2

**替代方案**:
- 最少连接: 无法体现权重差异
- 加权轮询: 需维护全局轮询状态，跨实例不友好

### D3: 熔断状态 - 内存 + 可查询

**选择**: 熔断状态存内存（Map），通过 API 可查询

**理由**:
- 现有 `api-key-circuit.ts` 已实现内存熔断
- 无需持久化，重启后自然恢复
- 提供 API 查询熔断状态供前端展示

### D4: 前端 UI - 嵌入 Provider 编辑表单

**选择**: 嵌入表单而非独立页面

**理由**:
- Key 与 Provider 强关联，放在一起更直观
- 减少页面跳转，提升配置效率

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| 数据迁移: 现有 providers.key 数组需迁移到新表 | 提供迁移脚本，启动时自动迁移 |
| 内存熔断状态丢失: 重启后状态清空 | 设计如此，重启后自然恢复;前端提示熔断状态已重置 |
| 权重配置错误: 权重 0 或负数 | Schema 约束 weight >= 1，前端校验 |

## Migration Plan

1. **数据迁移脚本**: 启动时检查 `provider_keys` 表是否存在，不存在则从 `providers.key` 迁移
2. **向后兼容**: 保留 `providers.key` 字段，读取时优先 `provider_keys` 表
3. **回滚**: 删除 `provider_keys` 表即可回退到旧逻辑

## Open Questions

（无）
