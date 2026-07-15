---
comet_change: provider-keys-enhancement
role: technical-design
canonical_spec: openspec
---

# Provider Keys Enhancement — 技术设计文档

## 1. 数据模型

### 1.1 provider_keys 表

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

### 1.2 Drizzle Schema 定义

`src/drizzle/schema.ts` 新增：

```typescript
export const providerKeys = pgTable('provider_keys', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  key: varchar('key').notNull(),
  name: varchar('name'),
  weight: integer('weight').notNull().default(1),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

### 1.3 Relations

```typescript
export const providerRelations = relations(providers, ({ many }) => ({
  providerKeys: many(providerKeys),
}));

export const providerKeyRelations = relations(providerKeys, ({ one }) => ({
  provider: one(providers, {
    fields: [providerKeys.providerId],
    references: [providers.id],
  }),
}));
```

## 2. Repository 层

`src/repository/provider-keys.ts` 包含：

- `listProviderKeys(providerId: number)`: 查询某 provider 的所有 enabled keys
- `getProviderKeyById(id: number)`: 按 ID 查询单个 key
- `createProviderKey(data)`: 创建新 key
- `updateProviderKey(id, data)`: 更新 key（weight, name, isEnabled）
- `deleteProviderKey(id)`: 删除 key
- `resetKeyCircuit(id)`: 手动恢复熔断

### 缓存策略

```typescript
const providerKeysCache = new Map<number, { data: ProviderKey[]; expiry: number }>();
const CACHE_TTL = 30_000; // 30s

function getCachedKeys(providerId: number): ProviderKey[] | null { ... }
function setCachedKeys(providerId: number, keys: ProviderKey[]): void { ... }
function invalidateKeysCache(providerId: number): void { ... }
```

## 3. 负载均衡（权重比算法）

`src/lib/api-key-circuit.ts` 重构 `selectAvailableKey`：

```typescript
export function selectAvailableKey(
  keys: ProviderKey[],
  providerId: number
): { key: string; index: number } | null {
  const enabledKeys = keys.filter(k => k.isEnabled && !isKeyCircuitOpen(k.key));
  if (enabledKeys.length === 0) return null;

  // 权重比算法: 选择 (当前连接数 / 权重) 最小的 Key
  let bestKey: ProviderKey | null = null;
  let bestRatio = Infinity;

  for (const k of enabledKeys) {
    const connections = getKeyConnectionCount(providerId, k.id);
    const ratio = connections / k.weight;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestKey = k;
    }
  }

  if (!bestKey) return null;
  return { key: bestKey.key, index: bestKey.id };
}
```

## 4. 熔断状态管理

`src/lib/api-key-circuit.ts` 新增：

- Key 级熔断 Map 改为 `keyHash → CircuitState`（含 `until` + `halfOpenTrials`）
- `recordKeyFailure(key)` — 递增失败计数，达阈值后熔断
- `recordKeySuccess(key)` — 重置失败计数，关闭熔断
- `isKeyCircuitOpen(key)` — 检查熔断状态
- `getKeyCircuitState(key)` — 返回 `closed | open | half-open`
- `resetKeyCircuit(key)` — 手动熔断恢复

熔断参数复用 Provider 级配置（从 `providers` 表读取）。

## 5. REST API

`src/app/api/v1/resources/provider-keys/` 目录：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/v1/providers/{id}/keys` | GET | 列表（含熔断状态） |
| `/api/v1/providers/{id}/keys` | POST | 创建 |
| `/api/v1/providers/{providerId}/keys/{keyId}` | PATCH | 更新 |
| `/api/v1/providers/{providerId}/keys/{keyId}` | DELETE | 删除 |
| `/api/v1/providers/{providerId}/keys/{keyId}/reset-circuit` | POST | 手动恢复熔断 |

## 6. 数据迁移

`scripts/migrate-provider-keys.ts` — 启动时自动执行：

1. 检查 `provider_keys` 表是否有数据
2. 若无数据，遍历 `providers` 表
3. 对每个 `providers.key: string[]` 数组中的 key，插入到 `provider_keys` 表
4. 权重全部设为 1（默认值）
5. 记录迁移日志

## 7. 前端 UI

嵌入 Provider 编辑表单 `src/app/[locale]/dashboard/settings/providers/_components/`：

- `provider-keys-list.tsx` — Key 列表（dnd-kit 可拖拽排序？暂不实现排序）
- `provider-key-form.tsx` — Key 编辑表单（name, weight, isEnabled）
- `provider-key-circuit-status.tsx` — 熔断状态 Badge + 恢复按钮

## 8. 测试策略

**单元测试 (tests/unit/lib/api-key-circuit.test.ts)**：
- 权重比算法：同权重、不同权重、单 Key 场景
- 熔断状态：打开、关闭、半开恢复
- 手动恢复熔断
- 禁用 Key 不参与选择

**集成测试 (tests/api/v1/provider-keys/)**：
- CRUD 端点权限校验
- 创建/更新/删除 key
- 级联删除（删除 Provider 时关联 Key 自动删除）
- 手动恢复熔断端点