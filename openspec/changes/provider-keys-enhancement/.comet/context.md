# Comet Design Handoff

- Change: provider-keys-enhancement
- Phase: design
- Mode: compact
- Context hash: c800685ff247cce564c3739e30cb75dbe4cd3f3542e3e8e6fca127756605145c

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/provider-keys-enhancement/proposal.md

- Source: openspec/changes/provider-keys-enhancement/proposal.md
- Lines: 1-31
- SHA256: 22411fb88a01adefc9f97618a670d537c83e38835e6a03e9f593aed310649978

```md
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
```

## openspec/changes/provider-keys-enhancement/design.md

- Source: openspec/changes/provider-keys-enhancement/design.md
- Lines: 1-96
- SHA256: 9ebf083554e19311aa7b83f8d52e60058694b8d5c7f7fb56d61b1d554de2c4d6

[TRUNCATED]

```md
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

```

Full source: openspec/changes/provider-keys-enhancement/design.md

## openspec/changes/provider-keys-enhancement/tasks.md

- Source: openspec/changes/provider-keys-enhancement/tasks.md
- Lines: 1-48
- SHA256: c0f442dea38931bf467ad9e9c608a68362c11cc9aa7765b100b2921d3a0bbc9d

```md
## 1. 数据库模型

- [ ] 1.1 在 drizzle schema 中添加 provider_keys 表 (src/drizzle/schema.ts)
- [ ] 1.2 生成并验证迁移文件 (drizzle/)
- [ ] 1.3 创建现有 providers.key 数据迁移脚本 (scripts/migrate-provider-keys.ts)

## 2. Repository 层

- [ ] 2.1 创建 providerKeys repository 及 CRUD 操作 (src/repository/provider-keys.ts)
- [ ] 2.2 在 schema 中添加 provider key relations (src/drizzle/schema.ts)
- [ ] 2.3 更新 provider repository 包含 keys relation (src/repository/provider.ts)

## 3. 负载均衡逻辑

- [ ] 3.1 重构 selectAvailableKey 使用权重比算法 (src/lib/api-key-circuit.ts)
- [ ] 3.2 添加 Key 级熔断状态管理 (src/lib/api-key-circuit.ts)
- [ ] 3.3 实现手动熔断恢复功能 (src/lib/api-key-circuit.ts)
- [ ] 3.4 添加熔断状态查询函数 (src/lib/api-key-circuit.ts)

## 4. REST API

- [ ] 4.1 创建 provider keys router 和 handlers (src/app/api/v1/resources/provider-keys/)
- [ ] 4.2 实现 list provider keys 端点 (GET /api/v1/providers/{id}/keys)
- [ ] 4.3 实现 create provider key 端点 (POST /api/v1/providers/{id}/keys)
- [ ] 4.4 实现 update provider key 端点 (PATCH /api/v1/providers/{providerId}/keys/{keyId})
- [ ] 4.5 实现 delete provider key 端点 (DELETE /api/v1/providers/{providerId}/keys/{keyId})
- [ ] 4.6 实现 reset key circuit 端点 (POST /api/v1/providers/{providerId}/keys/{keyId}/reset-circuit)
- [ ] 4.7 添加 provider keys OpenAPI schemas (src/lib/api/v1/schemas/provider-keys.ts)

## 5. 前端 UI

- [ ] 5.1 创建 ProviderKeysList 组件 (src/app/[locale]/dashboard/settings/providers/_components/provider-keys-list.tsx)
- [ ] 5.2 添加 Key 表单支持权重和启用控制 (src/app/[locale]/dashboard/settings/providers/_components/provider-key-form.tsx)
- [ ] 5.3 将 keys 列表集成到 provider 编辑表单 (src/app/[locale]/dashboard/settings/providers/_components/provider-form.tsx)
- [ ] 5.4 展示 key 熔断状态及重置按钮 (src/app/[locale]/dashboard/settings/providers/_components/provider-key-circuit-status.tsx)
- [ ] 5.5 添加 provider keys UI 的 i18n 消息 (messages/*/settings/providers/form/key.json)

## 6. 集成

- [ ] 6.1 更新 forwarder 使用新的 selectAvailableKey 逻辑 (src/app/v1/_lib/proxy/forwarder.ts)
- [ ] 6.2 更新 provider selector 查询 provider_keys 表 (src/app/v1/_lib/proxy/provider-selector.ts)
- [ ] 6.3 添加启动时 provider_keys 表迁移检查 (src/lib/startup-migration.ts)

## 7. 测试

- [ ] 7.1 编写权重比负载均衡单元测试 (tests/unit/lib/api-key-circuit.test.ts)
- [ ] 7.2 编写 Key 级熔断单元测试 (tests/unit/lib/api-key-circuit.test.ts)
- [ ] 7.3 编写 provider keys API 集成测试 (tests/api/v1/provider-keys/)
- [ ] 7.4 编写现有 key 数据迁移测试 (tests/integration/migrate-provider-keys.test.ts)
```

## openspec/changes/provider-keys-enhancement/specs/provider-keys-circuit-breaker/spec.md

- Source: openspec/changes/provider-keys-enhancement/specs/provider-keys-circuit-breaker/spec.md
- Lines: 1-36
- SHA256: 763ec2a7ae67f3a22c84abf8fff32b1819edc1e62bd862d45546908ce92aa36d

```md
## ADDED Requirements

### Requirement: Key-level circuit breaker

The system SHALL maintain independent circuit breaker state per provider key.

#### Scenario: Key circuit opens on failures
- **WHEN** key experiences failures reaching circuitBreakerFailureThreshold
- **THEN** system opens circuit for that specific key only

#### Scenario: Key circuit auto-recovers
- **WHEN** circuit-open duration elapses and key succeeds in half-open state
- **THEN** system closes circuit and key becomes available for load balancing

### Requirement: Manual circuit reset

The system SHALL allow administrators to manually reset circuit breaker state for a key.

#### Scenario: Admin resets circuit
- **WHEN** administrator clicks reset button for circuit-open key
- **THEN** system clears circuit state and key becomes available immediately

### Requirement: Circuit state query

The system SHALL provide API endpoint to query circuit breaker state for each key.

#### Scenario: Query key circuit state
- **WHEN** administrator requests provider keys list
- **THEN** system returns each key's circuit state (closed/open/half-open)

### Requirement: Reuse provider circuit parameters

The system SHALL reuse provider-level circuit breaker parameters for key-level circuit.

#### Scenario: Key circuit uses provider thresholds
- **WHEN** provider has circuitBreakerFailureThreshold=5 and circuitBreakerOpenDuration=1800000
- **THEN** key circuit uses same thresholds and duration
```

## openspec/changes/provider-keys-enhancement/specs/provider-keys-load-balancing/spec.md

- Source: openspec/changes/provider-keys-enhancement/specs/provider-keys-load-balancing/spec.md
- Lines: 1-36
- SHA256: 62326533f6f22f5235fba4a2b09509795a134239311e0e5d8f8994cf4c2aa4e5

```md
## ADDED Requirements

### Requirement: Weighted load balancing

The system SHALL select provider keys based on weight ratio algorithm.

#### Scenario: Select key by weight ratio
- **WHEN** key1 has weight 1 with 2 connections and key2 has weight 2 with 3 connections
- **THEN** system calculates ratio key1=2/1=2, key2=3/2=1.5 and selects key2

#### Scenario: All keys same weight
- **WHEN** all keys have weight 1
- **THEN** system selects key with minimum connections (least connections fallback)

#### Scenario: Single key available
- **WHEN** only one key exists for provider
- **THEN** system always selects that key regardless of weight

### Requirement: Exclude disabled keys

The system SHALL exclude keys with is_enabled=false from load balancing.

#### Scenario: Disabled key not selected
- **WHEN** provider has 2 keys, one disabled
- **THEN** system only selects from enabled key

### Requirement: Exclude circuit-open keys

The system SHALL exclude keys in circuit-open state from load balancing.

#### Scenario: Circuit-open key bypassed
- **WHEN** key has circuit-open status
- **THEN** system skips that key and selects next available key

#### Scenario: All keys circuit-open
- **WHEN** all keys are circuit-open
- **THEN** system selects key with minimum ratio as fallback (with warning)
```

## openspec/changes/provider-keys-enhancement/specs/provider-keys-management/spec.md

- Source: openspec/changes/provider-keys-enhancement/specs/provider-keys-management/spec.md
- Lines: 1-37
- SHA256: b16a0b252a3a769cb72dbd20fffa2ed6f50d867ece90740a3b273e6a19aa4bd1

```md
## ADDED Requirements

### Requirement: Provider Key CRUD

The system SHALL allow administrators to create, read, update, and delete provider keys through REST API and Web UI.

#### Scenario: Create provider key
- **WHEN** administrator creates a new key for a provider with weight 2
- **THEN** system stores the key in provider_keys table with weight 2 and is_enabled true

#### Scenario: List provider keys
- **WHEN** administrator views provider detail page
- **THEN** system displays all keys with their weight, enabled status, and circuit state

#### Scenario: Update key weight
- **WHEN** administrator changes key weight from 1 to 3
- **THEN** system updates weight and subsequent load balancing reflects new ratio

#### Scenario: Disable key manually
- **WHEN** administrator sets is_enabled to false for a key
- **THEN** system excludes that key from load balancing immediately

### Requirement: Key weight validation

The system SHALL enforce minimum weight of 1 for all provider keys.

#### Scenario: Reject invalid weight
- **WHEN** administrator attempts to set weight to 0 or negative
- **THEN** system rejects with validation error

### Requirement: Key cascade delete

The system SHALL delete all provider keys when parent provider is deleted.

#### Scenario: Delete provider with keys
- **WHEN** administrator deletes a provider
- **THEN** system cascades delete all associated keys in provider_keys table

```
