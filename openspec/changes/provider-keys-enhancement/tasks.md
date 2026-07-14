## 1. 数据库模型

- [x] 1.1 在 drizzle schema 中添加 provider_keys 表 (src/drizzle/schema.ts)
- [x] 1.2 生成并验证迁移文件 (drizzle/)
- [x] 1.3 创建现有 providers.key 数据迁移脚本 (scripts/migrate-provider-keys.ts)

## 2. Repository 层

- [x] 2.1 创建 providerKeys repository 及 CRUD 操作 (src/repository/provider-keys.ts)
- [x] 2.2 在 schema 中添加 provider key relations (src/drizzle/schema.ts)
- [ ] 2.3 更新 provider repository 包含 keys relation (src/repository/provider.ts)

## 3. 负载均衡逻辑

- [x] 3.1 重构 selectAvailableKey 使用权重比算法 (src/lib/api-key-circuit.ts)
- [x] 3.2 添加 Key 级熔断状态管理 (src/lib/api-key-circuit.ts)
- [x] 3.3 实现手动熔断恢复功能 (src/lib/api-key-circuit.ts)
- [x] 3.4 添加熔断状态查询函数 (src/lib/api-key-circuit.ts)

## 4. REST API

- [x] 4.1 创建 provider keys router 和 handlers (src/app/api/v1/resources/provider-keys/)
- [x] 4.2 实现 list provider keys 端点 (GET /api/v1/providers/{id}/keys)
- [x] 4.3 实现 create provider key 端点 (POST /api/v1/providers/{id}/keys)
- [x] 4.4 实现 update provider key 端点 (PATCH /api/v1/providers/{providerId}/keys/{keyId})
- [x] 4.5 实现 delete provider key 端点 (DELETE /api/v1/providers/{providerId}/keys/{keyId})
- [x] 4.6 实现 reset key circuit 端点 (POST /api/v1/providers/{providerId}/keys/{keyId}/reset-circuit)
- [x] 4.7 添加 provider keys OpenAPI schemas (src/lib/api/v1/schemas/provider-keys.ts)

## 5. 前端 UI

- [x] 5.1 创建 ProviderKeysList 组件 (src/app/[locale]/dashboard/settings/providers/_components/provider-keys-list.tsx)
- [x] 5.2 添加 Key 表单支持权重和启用控制 (src/app/[locale]/dashboard/settings/providers/_components/provider-key-form.tsx)
- [x] 5.3 将 keys 列表集成到 provider 编辑表单 (src/app/[locale]/dashboard/settings/providers/_components/provider-form.tsx)
- [x] 5.4 展示 key 熔断状态及重置按钮 (src/app/[locale]/dashboard/settings/providers/_components/provider-key-circuit-status.tsx)
- [x] 5.5 添加 provider keys UI 的 i18n 消息 (messages/*/settings/providers/form/keys.json)

## 6. 集成

- [ ] 6.1 更新 forwarder 使用新的 selectAvailableKey 逻辑 (src/app/v1/_lib/proxy/forwarder.ts)
- [ ] 6.2 更新 provider selector 查询 provider_keys 表 (src/app/v1/_lib/proxy/provider-selector.ts)
- [ ] 6.3 添加启动时 provider_keys 表迁移检查 (src/lib/startup-migration.ts)

## 7. 测试

- [ ] 7.1 编写权重比负载均衡单元测试 (tests/unit/lib/api-key-circuit.test.ts)
- [ ] 7.2 编写 Key 级熔断单元测试 (tests/unit/lib/api-key-circuit.test.ts)
- [ ] 7.3 编写 provider keys API 集成测试 (tests/api/v1/provider-keys/)
- [ ] 7.4 编写现有 key 数据迁移测试 (tests/integration/migrate-provider-keys.test.ts)