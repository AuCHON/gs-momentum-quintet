# Cursor 接入

## 方式〇：原生 skills 目录（最简，先试这个）

Cursor 原生支持 Agent Skills（读取 `.agents/skills/` 下的 SKILL.md）：

```bash
npx skills add ospops/quality-gate -a cursor
# 或手动：把整个包放到 <仓库>/.agents/skills/quality-gate/（文件夹名与 name 一致）
```

SKILL.md 会被识别为技能。要强制自动触发（任务开始/汇报完成前必走流程），
再按下文方式二配置 Project Rules。

## 方式一：自定义 Agent（Cursor ≥ 0.46）

1. 打开 Agent 面板 → 新建 Agent，建两个：
   - **requirement-adversary**：Instructions 粘贴 `prompts/requirement-adversary.md` 全文；
     工具只勾 Read / Search / Terminal（不勾 Edit；Terminal 仍可经重定向写文件，
     权限层只能缓解，只读最终靠提示词铁律兜底）；
   - **implementation-adversary**：Instructions 粘贴 `prompts/implementation-adversary.md` 全文；
     工具同上。
2. 开发前把需求发给 requirement-adversary；开发后把改动摘要发给 implementation-adversary；
3. 按根目录 [SKILL.md](../SKILL.md) 的阶段 A/B/C 流程与判定规则走循环，
   报告按 [examples/report-template.md](../examples/report-template.md) 归档。

## 方式二：Project Rules（自动触发编排）

在 `.cursor/rules/quality-gate.mdc` 写入（把编排协议交给 Cursor 的规则机制）：

```
---
description: 对抗式开发质量门（仅开发回合触发）：任务开始先需求对抗；实现完成、汇报"完成"前必须走完实现对抗循环直至 PASS
alwaysApply: true
---
按仓库 doc 或随包 SKILL.md（quality-gate）执行：
0. 预筛选（先于一切）：仅当本回合将向仓库写/改交付代码或配置才走以下流程；纯问答、
   概念解释、方案讨论、读代码、排查诊断、闲聊、用完即弃的验证代码等回合直接正常
   回答——不派对抗、不写报告、不必说明"已跳过"；唯一例外：被问及此前挂起交付的
   "完成"（"改完了吗"）→ 先补走该交付的阶段 C 再宣告完成；针对仓库内代码/文档或
   对话中贴出的方案/片段的点名或评估式问法（"审查/攻一下""有没有问题/隐患/安全吗"
   "帮我看看""把把关""行不行"等）= 审计模式：代码走实现对抗、需求/设计文档派需求
   对抗，发现对话直返（转修复或用户要求归档才落盘）；
1. 新任务先派 requirement-adversary（提示词见其 Agent 定义）审查需求漏洞并修正（中途增量需求只补审增量；琐碎/机械豁免与"修报错"类转修复降级见 SKILL.md 0.2 与阶段 A 第 4 条，同样适用；冷启动续作回合——收集全部"进行中"报告（多份未指认则枚举；判据见 0.1 细则）——不重跑本步，按报告状态行续作）；
2. 实现完成后跑自测门（typecheck/test/build），再派 implementation-adversary 攻击实现；
3. 🔴/🟠 发现必须修复后重审（新对话重派并附上轮报告路径，复审只验证上轮修复+回归，累计 5 轮上限），
   PASS 前全量测试全绿（快套件连续 3 次/慢套件 1 次，迭代轮次跑定向）；
4. 将走完整阶段 C 的交付在阶段 A 结束落报告骨架于 docs/reports/YYYYMMDDHHIISS-ai-report-<主题slug>.md（A 豁免且将走 C 的进 C1 前建；日期时间 = 骨架创建时刻，slug 用 ASCII；重名加 -2/-3 序号不覆盖；豁免/零 diff/放弃收场须收口），状态行每轮更新、终态收口（模板见 examples/report-template.md）。
两个对抗角色只读不写；所有修复与报告由主会话完成。
```

## 注意

- Cursor 无等价 Claude Code 的 skill 机制时，SKILL.md 作为操作手册由主会话遵循；
- 审查 Agent 务必不勾选 Edit/文件写入工具——权限层只能缓解（Terminal 重定向仍可写），只读最终靠提示词铁律兜底。
