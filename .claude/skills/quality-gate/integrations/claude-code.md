# Claude Code 接入

## 安装

```bash
# 方式一：skills CLI（推荐，自动处理目录映射）
npx skills add ospops/quality-gate -a claude-code
# 文件落在 .agents/skills/quality-gate/，并自动在 .claude/skills/ 建链接
```

方式二（手动）：把整个包拷到目标仓库，**文件夹名保持 `quality-gate`（与 name 一致）**：

```
<仓库>/.claude/skills/quality-gate/
├── SKILL.md
├── prompts/…
├── integrations/…
└── examples/…
```

## 强制自动触发（基础步骤，不是可选）

Skill 的自动调用取决于模型对 description 的判断，**并不稳定**——只装技能时
`/quality-gate <范围>` 手动审查可用，但"任务开始先需求对抗、汇报完成前必走实现对抗"
需要规则兜底。规则**必须自带预筛选门槛**：写成无条件的"任务开始先…"，纯问答、
概念解释类回合也会被拖进全流程，白费一整轮对抗。在仓库根 `CLAUDE.md` 追加
（从下一个会话起生效）：

```
仅开发回合（本回合将向仓库写/改交付代码或配置）走 quality-gate：任务开始先需求对抗（中途增量需求只补审增量；琐碎/机械/纯文档/用户说不用审等豁免与"修报错"类转修复降级见 SKILL.md 0.2 与阶段 A 第 4 条，同样适用；冷启动续作回合——收集全部"进行中"报告（多份未指认则枚举；判据见 0.1 细则）——不重跑需求对抗，按状态行续作），实现完成、汇报"完成"前走完实现对抗循环直至 PASS，将走完整阶段 C 的交付在阶段 A 结束落报告骨架（A 豁免且将走 C 的进 C1 前建；豁免/零 diff/放弃收场须收口）、状态行每轮更新（详见 .claude/skills/quality-gate/SKILL.md 第 0 步、0.1 冷启动续作细则、0.2 与阶段 A 第 3 条）。
非开发回合（纯问答、解释、方案讨论、读代码、排查诊断、闲聊，及用完即弃的验证代码——凡不向仓库留下交付改动）不触发本流程：直接回答，不派对抗、不写报告、不必说明"已跳过"；唯一例外是被问及此前挂起交付的"完成"（如"改完了吗"）——先补走该交付的阶段 C 再宣告完成。针对仓库内代码/文档或对话中贴出的方案/片段的点名或评估式问法（"审查/攻一下""有没有问题/隐患/安全吗""帮我看看""把把关""行不行"等）视同手动 /quality-gate 审计模式：对象是代码走实现对抗、是需求/设计文档派需求对抗，发现对话直返（详见 SKILL.md 阶段 C·审计模式）。
```

## 增强（可选）：原生 Agent 薄壳（免去运行时读文件）

在 `.claude/agents/` 创建薄壳：

`.claude/agents/requirement-adversary.md`：

```markdown
---
name: requirement-adversary
description: 需求对抗审查员（只读）。开发前审查需求漏洞，开发后核对实现一致性；绝不修改文件。
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit, NotebookEdit
---
先读取 .claude/skills/quality-gate/prompts/requirement-adversary.md，
严格按其全文执行（该文件为唯一权威版本）。
```

`.claude/agents/implementation-adversary.md`：同结构，name/description 换为
implementation-adversary，读取 `prompts/implementation-adversary.md`。

> **只读保证的诚实说明**：`disallowedTools` 挡住了 Write/Edit 类工具，但 **Bash 仍可通过
> 重定向写文件**（`echo x > file`），工具层无法完全杜绝——而跑测试又必须给 Bash，
> 这是权衡。残余风险靠提示词铁律约束；需要强保证的仓库可在沙箱/容器里跑审查，
> 或在 `.claude/settings.json` 的 `permissions.deny` 里加细粒度 Bash 拒绝规则
> （该配置对子代理同样生效）。

## 派发方式

- 有原生 Agent 薄壳：Agent 工具按类型直接派（薄壳自动加载权威提示词）；
- 仅有技能：派**通用**子代理（如 general-purpose），提示词 = 读取 `prompts/*.md` 全文 +
  本次范围 + 铁律。**不要用 Explore 等纯搜索型子代理跑对抗审查**——其定位是定位代码
  而非审计，只会得到浅结果；
- 无 Agent 工具：主 Agent 降级自审（重新通读文件、审查期禁写、报告注明"降级自审"）。
