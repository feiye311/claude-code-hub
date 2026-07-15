---
change: provider-keys-enhancement
design-doc: docs/superpowers/specs/2026-07-14-provider-keys-enhancement-design.md
base-ref: 5dbe7a5dce9f62afa637552a71974fc1ba641878
---

# Provider Keys Enhancement 实施计划

## 概述

将 Provider 的 `key: string[]` 字段迁移到独立的 `provider_keys` 表，支持：
- 每个 Key 独立配置权重（weight）和启用状态（isEnabled）
- Key 级熔断状态管理
- 权重比负载均衡算法
- 前端 UI 内嵌 Key 管理

## 前置条件

- Base ref: `5dbe7a5dce9f62afa637552a71974fc1ba641878`
- 熟悉现有代码模式：
  - Drizzle ORM schema 定义（`src/drizzle/schema.ts`）
  - Repository 层模式（`src/repository/*.ts`）
  - REST API 路由和处理器模式（`src/app/api/v1/resources/*/`）
  - API Key 熔断逻辑（`src/lib/api-key-circuit.ts`）

---

## 1. 数据库模型

### 任务 1.1 添加 provider_keys 表定义

**文件**: `src/drizzle/schema.ts`

**步骤**:
1. 在 `providers` 表定义之后添加 `providerKeys` 表：
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
   }, (table) => ({
     providerKeysProviderIdIdx: index('idx_provider_keys_provider_id').on(table.providerId),
   }));
   ```

2. 添加 relations：
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

**验收标准**:
- Schema 编译通过（`pnpm drizzle-kit generate`）
- 表定义包含所有必需字段和索引
- Relations 正确关联 `providers` ↔ `providerKeys`

### 任务 1.2 生成迁移文件

**步骤**:
1. 运行 `pnpm drizzle-kit generate` 生成迁移文件
2. 检查生成的 SQL：
   - `CREATE TABLE provider_keys`
   - `CREATE INDEX idx_provider_keys_provider_id`
   - 外键约束 `ON DELETE CASCADE`
3. 运行 `pnpm drizzle-kit push` 应用到开发数据库

**验收标准**:
- 迁移文件生成在 `drizzle/` 目录
- SQL 语法正确
- 数据库表创建成功

### 任务 1.3 创建数据迁移脚本

**文件**: `scripts/migrate-provider-keys.ts`

**步骤**:
1. 检查 `provider_keys` 表是否为空
2. 若为空，遍历 `providers` 表：
   - 对每个 `providers.key: string[]` 数组元素
   - 插入到 `provider_keys` 表，设置：
     - `provider_id`: 父 provider ID
     - `key`: 原始 key 字符串
     - `weight`: 1（默认值）
     - `is_enabled`: true
     - `name`: null（可选）
3. 记录迁移日志（多少个 provider、多少个 key）
4. 添加到启动脚本 `src/lib/startup-migration.ts`

**验收标准**:
- 脚本幂等（多次运行安全）
- 现有数据完整迁移
- 迁移日志可追溯

---

## 2. Repository 层

### 任务 2.1 创建 providerKeys repository

**文件**: `src/repository/provider-keys.ts`

**函数**:
```typescript
export async function listProviderKeys(providerId: number): Promise<ProviderKey[]>
export async function getProviderKeyById(id: number): Promise<ProviderKey | null>
export async function createProviderKey(data: CreateProviderKeyData): Promise<ProviderKey>
export async function updateProviderKey(id: number, data: UpdateProviderKeyData): Promise<ProviderKey | null>
export async function deleteProviderKey(id: number): Promise<boolean>
export async function resetKeyCircuit(id: number): Promise<void>
```

**缓存实现**:
```typescript
const providerKeysCache = new Map<number, { data: ProviderKey[]; expiry: number }>();
const CACHE_TTL = 30_000;

function getCachedKeys(providerId: number): ProviderKey[] | null
function setCachedKeys(providerId: number, keys: ProviderKey[]): void
function invalidateKeysCache(providerId: number): void
```

**步骤**:
1. 定义类型（`ProviderKey`, `CreateProviderKeyData`, `UpdateProviderKeyData`）
2. 实现 CRUD 函数，遵循现有 repository 模式（参考 `src/repository/provider-endpoints.ts`）
3. 实现内存缓存（30s TTL）
4. 添加缓存失效逻辑：
   - `createProviderKey` → invalidate
   - `updateProviderKey` → invalidate
   - `deleteProviderKey` → invalidate

**验收标准**:
- 所有 CRUD 函数单元测试通过
- 缓存正确失效
- 遵循 repository 约定（server-only、事务处理）

### 任务 2.2 更新 provider repository

**文件**: `src/repository/provider.ts`

**步骤**:
1. 在 `createProvider` 事务中：
   - 插入 provider 后，同步创建 `provider_keys` 记录
   - 废弃 `providers.key` 字段（保留兼容性，设为 `[]`）
2. 在 `updateProvider` 中：
   - 如果传入 `key` 字段，改为操作 `provider_keys` 表
   - 保留旧字段处理逻辑（向后兼容）
3. 在 `findProviderById` 和 `findAllProviders` 中：
   - JOIN 查询 `provider_keys`
   - 组装 `keys: ProviderKey[]` 到返回对象

**验收标准**:
- Provider 创建时自动创建 provider_keys
- Provider 删除时级联删除 provider_keys
- 查询返回包含 keys 关联数据

---

## 3. 负载均衡逻辑

### 任务 3.1 重构 selectAvailableKey

**文件**: `src/lib/api-key-circuit.ts`

**当前实现**:
- 输入: `keys: string[]`, `providerId: number`
- 算法: 最少连接（`connections / 1`）

**新实现**:
- 输入: `keys: ProviderKey[]`, `providerId: number`
- 算法: 权重比（`connections / weight`）

**步骤**:
1. 修改函数签名：
   ```typescript
   export function selectAvailableKey(
     keys: ProviderKey[],  // 改为对象数组
     providerId: number
   ): { key: string; keyId: number } | null
   ```

2. 过滤禁用和熔断的 Key：
   ```typescript
   const enabledKeys = keys.filter(k => k.isEnabled && !isKeyCircuitOpen(k.key));
   ```

3. 实现权重比算法：
   ```typescript
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
   ```

4. 更新返回值：使用 `keyId` 替代 `index`

**验收标准**:
- 单元测试覆盖：
  - 同权重场景（均匀分布）
  - 不同权重场景（权重 2:1 时负载比例 ~1:2）
  - 单 Key 场景
  - 全部熔断 fallback

### 任务 3.2 添加 Key 级熔断管理

**文件**: `src/lib/api-key-circuit.ts`

**新增函数**:
```typescript
export function recordKeyFailure(key: string): void  // 已有，扩展半开逻辑
export function recordKeySuccess(key: string): void  // 已有
export function isKeyCircuitOpen(key: string): boolean  // 已有
export function getKeyCircuitState(key: string): 'closed' | 'open' | 'half-open'  // 新增
export function resetKeyCircuit(key: string): void  // 新增（手动恢复）
```

**数据结构扩展**:
```typescript
interface CircuitState {
  until: number;           // 熔断结束时间戳
  halfOpenTrials: number;  // 半开状态成功尝试次数
}

const circuitOpenForKey = new Map<string, CircuitState>();
```

**步骤**:
1. 扩展 `circuitOpenForKey` 结构（添加 `halfOpenTrials`）
2. 实现 `getKeyCircuitState`：
   - `closed`: 无记录或已过期
   - `open`: 未过期
   - `half-open`: 过期但需验证
3. 实现 `resetKeyCircuit`：删除记录
4. 更新 `recordKeySuccess`：半开状态成功达到阈值后关闭熔断

**验收标准**:
- 熔断状态正确转换（closed → open → half-open → closed）
- 手动恢复立即生效
- 单元测试覆盖状态机

### 任务 3.3 添加熔断状态查询

**文件**: `src/lib/api-key-circuit.ts`

**新增函数**:
```typescript
export function getKeyCircuitInfo(key: string): {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  until?: number;
}
```

**步骤**:
1. 读取 `circuitOpenForKey` 和 `keyFailureCount`
2. 返回状态对象

**验收标准**:
- 返回完整熔断信息
- 供 API 端点使用

---

## 4. REST API

### 任务 4.1 创建 provider-keys router

**目录**: `src/app/api/v1/resources/provider-keys/`

**文件**:
- `router.ts` — 路由定义
- `handlers.ts` — 处理器实现

**端点**:
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/providers/{id}/keys` | 列出 keys（含熔断状态） |
| POST | `/api/v1/providers/{id}/keys` | 创建 key |
| PATCH | `/api/v1/providers/{providerId}/keys/{keyId}` | 更新 key |
| DELETE | `/api/v1/providers/{providerId}/keys/{keyId}` | 删除 key |
| POST | `/api/v1/providers/{providerId}/keys/{keyId}/reset-circuit` | 手动恢复熔断 |

**步骤**:
1. 参考 `src/app/api/v1/resources/provider-endpoints/router.ts` 模式
2. 使用 OpenAPI Hono 定义路由
3. 添加认证中间件 `requireAuth("admin")`
4. 定义 OpenAPI schemas

**验收标准**:
- 所有端点遵循现有 API 约定
- OpenAPI 文档自动生成
- 认证和权限校验正确

### 任务 4.2 实现 list provider keys

**处理器**: `listProviderKeys`

**步骤**:
1. 解析 `providerId` 参数
2. 调用 `listProviderKeys(providerId)`
3. 为每个 key 添加熔断状态：
   ```typescript
   keys.map(k => ({
     ...k,
     circuit: getKeyCircuitInfo(k.key),
   }))
   ```
4. 返回 `{ items: ProviderKeyWithCircuit[] }`

**验收标准**:
- 返回正确数据结构
- 包含熔断状态

### 任务 4.3 实现 create provider key

**处理器**: `createProviderKey`

**步骤**:
1. 解析 `providerId` 和 body
2. 验证 provider 存在
3. 调用 `createProviderKey(data)`
4. 返回 201 + 创建的对象

**验收标准**:
- 创建成功
- 缓存失效
- 权限校验正确

### 任务 4.4 实现 update provider key

**处理器**: `updateProviderKey`

**可更新字段**: `name`, `weight`, `isEnabled`

**步骤**:
1. 解析 `providerId` 和 `keyId`
2. 验证 key 属于该 provider
3. 调用 `updateProviderKey(keyId, data)`
4. 返回更新后的对象

**验收标准**:
- 更新成功
- 缓存失效

### 任务 4.5 实现 delete provider key

**处理器**: `deleteProviderKey`

**步骤**:
1. 解析 `providerId` 和 `keyId`
2. 验证 key 属于该 provider
3. 调用 `deleteProviderKey(keyId)`
4. 返回 204

**验收标准**:
- 删除成功
- 缓存失效

### 任务 4.6 实现 reset key circuit

**处理器**: `resetProviderKeyCircuit`

**步骤**:
1. 解析 `providerId` 和 `keyId`
2. 查询 key
3. 调用 `resetKeyCircuit(key.key)`
4. 返回 204

**验收标准**:
- 熔断状态立即重置

### 任务 4.7 添加 OpenAPI schemas

**文件**: `src/lib/api/v1/schemas/provider-keys.ts`

**步骤**:
1. 定义 Zod schemas：
   - `ProviderKeySchema`
   - `ProviderKeyCreateSchema`
   - `ProviderKeyUpdateSchema`
   - `ProviderKeyCircuitSchema`
   - `ProviderKeyIdParamSchema`
   - `ProviderIdParamSchema`
2. 参考 `src/lib/api/v1/schemas/provider-endpoints.ts` 模式

**验收标准**:
- 所有端点有对应 schema
- OpenAPI 文档正确

---

## 5. 前端 UI

### 任务 5.1 创建 ProviderKeysList 组件

**文件**: `src/app/[locale]/dashboard/settings/providers/_components/provider-keys-list.tsx`

**功能**:
- 显示 key 列表（name, key 前缀, weight, isEnabled）
- 显示熔断状态 Badge
- 支持添加/编辑/删除 key
- 暂不实现拖拽排序

**步骤**:
1. 使用 `useQuery` 获取 `/api/v1/providers/{id}/keys`
2. 渲染表格或卡片列表
3. 添加"添加 Key"按钮
4. 每行添加"编辑"和"删除"按钮

**验收标准**:
- 列表正确渲染
- 操作按钮可用

### 任务 5.2 创建 ProviderKeyForm 组件

**文件**: `src/app/[locale]/dashboard/settings/providers/_components/provider-key-form.tsx`

**字段**:
- `name`: 可选名称（输入框）
- `key`: 密钥（创建时必填，编辑时显示前缀）
- `weight`: 权重（数字输入，最小值 1）
- `isEnabled`: 启用状态（开关）

**步骤**:
1. 使用 `react-hook-form` + `zod` 验证
2. 提交时调用 POST/PATCH 端点
3. 成功后刷新列表

**验收标准**:
- 表单验证正确
- 提交成功后数据更新

### 任务 5.3 集成到 Provider 编辑表单

**文件**: `src/app/[locale]/dashboard/settings/providers/_components/provider-form.tsx`

**步骤**:
1. 在表单中添加"API Keys"区域
2. 渲染 `ProviderKeysList`
3. 创建 provider 时，同步创建初始 key

**验收标准**:
- Key 管理集成到 Provider 编辑流程
- 创建 Provider 时可添加初始 Key

### 任务 5.4 创建熔断状态组件

**文件**: `src/app/[locale]/dashboard/settings/providers/_components/provider-key-circuit-status.tsx`

**功能**:
- 显示熔断状态 Badge（closed=绿, open=红, half-open=黄）
- 显示失败次数和预计恢复时间
- "手动恢复"按钮（POST reset-circuit）

**验收标准**:
- 状态正确显示
- 手动恢复功能可用

### 任务 5.5 添加 i18n 消息

**文件**: `messages/*/settings/providers/form/provider-keys.json`

**步骤**:
1. 为 zh-CN, zh-TW, en, ja 创建消息文件
2. 定义所有 UI 文本（标签、提示、错误消息）

**验收标准**:
- 所有语言完整覆盖
- 使用项目 i18n 约定

---

## 6. 集成

### 任务 6.1 更新 forwarder

**文件**: `src/app/v1/_lib/proxy/forwarder.ts`

**步骤**:
1. 修改 `selectProviderKey` 调用：
   - 查询 `provider_keys` 表（替代从 `providers.key` 数组）
   - 调用 `selectAvailableKey(keys, providerId)`
2. 使用返回的 `keyId` 追踪连接

**验收标准**:
- Provider 请求正确路由
- 权重比算法生效

### 任务 6.2 更新 provider selector

**文件**: `src/app/v1/_lib/proxy/provider-selector.ts`

**步骤**:
1. 修改 provider 查询：
   - 包含 `provider_keys` 关联
2. 传递 `ProviderKey[]` 给 `selectAvailableKey`

**验收标准**:
- Provider 选择逻辑正确

### 任务 6.3 添加启动迁移检查

**文件**: `src/lib/startup-migration.ts`

**步骤**:
1. 导入 `scripts/migrate-provider-keys.ts`
2. 在应用启动时执行迁移

**验收标准**:
- 应用启动时自动迁移
- 幂等执行

---

## 7. 测试

### 任务 7.1 权重比负载均衡单元测试

**文件**: `tests/unit/lib/api-key-circuit.test.ts`

**测试用例**:
1. 同权重场景：2 个 key（weight=1），请求均匀分布
2. 不同权重场景：weight 1:2，负载比例 ~1:2
3. 单 Key 场景：总是选择唯一 key
4. 禁用 Key 不参与选择
5. 全部熔断 fallback

**验收标准**:
- 所有测试通过
- 覆盖率 ≥ 90%

### 任务 7.2 Key 级熔断单元测试

**文件**: `tests/unit/lib/api-key-circuit.test.ts`

**测试用例**:
1. 失败计数达到阈值后熔断
2. 熔断期间请求被拒绝
3. 熔断过期进入半开状态
4. 半开状态成功后关闭熔断
5. 手动恢复熔断

**验收标准**:
- 所有测试通过
- 状态机正确

### 任务 7.3 Provider Keys API 集成测试

**目录**: `tests/api/v1/provider-keys/`

**测试用例**:
1. List keys（权限校验）
2. Create key
3. Update key（weight, name, isEnabled）
4. Delete key
5. Reset circuit
6. 级联删除（删除 provider 时 key 自动删除）

**验收标准**:
- 所有测试通过
- 遵循 API 测试约定

### 任务 7.4 数据迁移集成测试

**文件**: `tests/integration/migrate-provider-keys.test.ts`

**测试用例**:
1. 空数据库迁移：无操作
2. 有数据迁移：正确转换
3. 幂等性：多次运行安全

**验收标准**:
- 所有测试通过
- 迁移逻辑正确

---

## 风险与缓解

1. **向后兼容性**:
   - 保留 `providers.key` 字段（设为 `[]`）
   - 迁移脚本幂等
   - 查询逻辑兼容旧数据

2. **性能**:
   - Repository 层缓存减少数据库查询
   - 批量查询避免 N+1

3. **数据一致性**:
   - 使用事务保证 provider 和 provider_keys 同步
   - 级联删除防止孤立数据

---

## 时间估算

- 数据库模型：4 小时
- Repository 层：6 小时
- 负载均衡：8 小时
- REST API：6 小时
- 前端 UI：8 小时
- 集成：4 小时
- 测试：8 小时
- **总计**：34 小时（约 4-5 天）

---

## 验收清单

- [ ] 所有任务完成
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 前端 UI 可用
- [ ] API 文档更新
- [ ] 迁移脚本测试通过
- [ ] Lint 和类型检查通过