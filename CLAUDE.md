# 项目工作规则（每次会话自动加载）

## 对抗式开发质量门（必须遵守）

- **任务开始先执行需求对抗**（requirement-adversary）：审查需求漏洞/歧义/矛盾并修正，再开发；
- 任何功能开发、bug 修复或行为性改动完成后、**向用户报告"完成"之前**，必须自动执行
  `.claude/skills/quality-gate` 的实现对抗循环（自测门 → implementation-adversary →
  汇总报告 → 修复 → 重审 → PASS），无需用户主动触发；
- 纯文档/格式化改动或用户明确豁免可跳过（汇报时说明原因）。

双对抗角色（提示词内嵌于 `.claude/skills/quality-gate/prompts/`，以只读子代理派出）**只读不写**，报告与修复由主 Agent 完成；
报告命名 `doc/reports/YYYYMMDD-ai-report-<主题>.md`；项目专属清单见 `doc/AI对抗Review流程.md`；
PASS 前 `npm test` 需连续 3 次全绿；同一问题重审超 3 轮未收敛则停下来向用户说明。