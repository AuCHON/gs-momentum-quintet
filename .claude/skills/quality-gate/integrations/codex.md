# Codex / AGENTS.md 约定工具接入

适用于 OpenAI Codex CLI 及一切遵循 `AGENTS.md` 约定的编码代理。

## 方式〇：原生 skills 目录（最简，先试这个）

Codex CLI 原生读取 `.agents/skills/` 下的 SKILL.md：

```bash
npx skills add ospops/quality-gate -a codex
# 或手动：把整个包放到 <仓库>/.agents/skills/quality-gate/（文件夹名与 name 一致）
```

SKILL.md 会被识别为技能。要强制自动触发（任务开始/汇报完成前必走流程），
仍建议按下文方式一配置 AGENTS.md 规则。

## 方式一：AGENTS.md 编排（自动触发）

1. **角色提示词**：把 `prompts/requirement-adversary.md` 与 `prompts/implementation-adversary.md`
   保存到仓库 `docs/agents/` 下（下文模板按此路径引用，若放到别处请同步改模板中的路径）；
2. 在仓库根 `AGENTS.md` 追加：

   ```markdown
   ## 对抗式开发质量门（仅开发回合）

   - 预筛选：仅当本回合将向仓库写/改交付代码或配置才适用本节；纯问答、概念解释、
     方案讨论、读代码、排查诊断、闲聊、用完即弃的验证代码等回合直接正常回答——
     不派对抗角色、不写报告、不必说明"已跳过"；唯一例外：被问及此前挂起交付的
     "完成"（"改完了吗"）→ 先补走该交付的阶段 C 再宣告完成；针对仓库内代码/文档
     或对话中贴出的方案/片段的点名或评估式问法（"审查/攻一下""有没有问题/隐患/
     安全吗""帮我看看""把把关""行不行"等）= 审计模式：代码走实现对抗、需求/设计
     文档派需求对抗，发现对话直返（转修复或用户要求归档才落盘）；
   - 新任务开始先执行需求对抗：将需求与 docs/agents/requirement-adversary.md 全文交给
     独立子代理/新会话，按其《需求漏洞清单》修正需求后再开发（中途增量需求只补审
     增量；琐碎/机械豁免与"修报错"类转修复降级见 SKILL.md 0.2 与阶段 A 第 4 条，同样
     适用；冷启动续作回合——收集全部"进行中"报告（多份未指认则枚举；判据见 0.1 细则）——不重跑需求对抗，按状态行续作）；
   - 实现完成、向用户报告"完成"之前必须执行实现对抗：先跑自测门
     （typecheck/test/build，缺项跳过并注明），再将改动清单与
     docs/agents/implementation-adversary.md 全文交给独立子代理/新会话；
   - 🔴/🟠 发现必须修复后重审（每轮新开独立会话并附上轮报告路径，复审只验证上轮修复+回归，
     累计 5 轮上限），PASS 前全量测试全绿（快套件连续 3 次/慢套件 1 次，迭代轮次跑定向）；
   - 将走完整阶段 C 的交付在阶段 A 结束落报告骨架于 docs/reports/YYYYMMDDHHIISS-ai-report-<主题slug>.md（A 豁免且将走 C 的进 C1 前建；日期时间 = 骨架创建时刻，slug 用 ASCII；重名加 -2/-3 序号不覆盖；豁免/零 diff/放弃收场须收口），状态行每轮更新、终态收口（模板 examples/report-template.md）；
   - 对抗角色只读不写；所有修复与报告由主会话完成。
   ```

3. 若工具支持多代理/子任务：两个对抗角色各配一个只读权限的子代理；
   不支持则用"新开会话贴提示词"方式获得独立上下文（见 [generic.md](generic.md)）。

## 注意

- Codex 沙箱模式建议给对抗会话 `read-only` 档，权限层落实只读铁律；
- 报告文件名规则 `YYYYMMDDHHIISS-ai-report-<主题slug>.md` 全工具统一，不得更改。
