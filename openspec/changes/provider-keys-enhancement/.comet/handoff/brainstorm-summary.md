# Brainstorm Summary

- Change: provider-keys-enhancement
- Date: 2026-07-14

## 确认的技术方案

**1. 数据加载：懒加载 + 短 TTL 缓存**
- 首次查询时加载 provider_keys 到内存 Map，缓存 30s
- CRUD 后清除该 provider 的缓存项

**2. 迁移策略：启动自动迁移 + 向前兼容**
- 启动时自动迁移 providers.key 数据到 provider_keys 表
- 运行时优先读 provider_keys，若为空则回退到 providers.key

**3. 负载均衡算法：权重比（连接数/权重）**
- 选择 ratio 最小的 Key
- 所有 Key 连接数为 0 时选第一个可用

**4. 熔断：复用 Provider 级参数，内存状态 + 手动恢复 API**

## 关键取舍与风险

| 风险 | 缓解措施 |
|------|---------|
| 数据迁移：现有 providers.key 数组需迁移到新表 | 提供迁移脚本，启动时自动迁移 |
| 内存熔断状态丢失：重启后状态清空 | 设计如此，重启后自然恢复；前端提示熔断状态已重置 |
| 权重配置错误：权重 0 或负数 | Schema 约束 weight >= 1，前端校验 |

## 测试策略

- 单元测试：权重比算法、Key 级熔断状态管理
- 集成测试：CRUD API 端点、迁移脚本
- 不涉及前端 e2e（UI 测试范围单独评估）

## Spec Patch

无（已在上一步创建完整 specs）