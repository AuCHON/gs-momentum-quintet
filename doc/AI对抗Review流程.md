# AI 对抗 Review 流程（项目专属清单）

本仓库的开发质量门由 `.claude/skills/quality-gate/SKILL.md` 编排（对抗提示词的唯一权威版本在
`.claude/skills/quality-gate/prompts/`），本清单只记录**本项目的专属约定**，与 CLAUDE.md 配套。

## 测试命令

- `npm test` = `node test/physics.test.js && node test/ui.test.js`（见 package.json）
- PASS 前 `npm test` 需连续 **3 次全绿**（快套件 3 连；详见 SKILL.md 稳定性条款）
- 语法快查：`node --check <file>`（本仓库无 lint/构建步骤，静态检查以语法检查代替）

## 对抗角色派出方式

- requirement-adversary / implementation-adversary：**只读**通用子代理，提示词 = `prompts/*.md`
  全文 + 本次范围（改动文件清单/审查对象）
- 派出时附带：① 本次自测门已跑内容（定向/全量）；② 历史已记录不修项（见下），避免重复报告

## 报告约定

- 目录 `doc/reports/`；命名 `YYYYMMDDHHIISS-ai-report-<主题slug>.md`（秒级时间戳；重名追加 -2/-3，禁止覆盖）
- 状态行每轮必更：`状态：进行中·第 N 轮·下一动作=<具体动作>`；终态 PASS / PASS·免审 / 终局·分歧（第 N 轮）/ 作废·<原因>
- **复审记录表为轮次权威**（跨会话轮次从该表恢复）；重审范围收窄为「上轮修复验证 + 回归」，不做全量重新攻击
- 重审每轮用**新的**独立上下文（新子代理），不复用旧结论

## 严重度标尺

🔴致命=功能错误/数据丢失 ｜ 🟠严重=特定条件出错 ｜ 🟡一般=体验/性能 ｜ 🔵建议

## 本项目已知历史记录（复审勿重复报告，除非发现更严重）

- 刷新/关标签页不落盘无尽当局成绩（无 beforeunload）——记录在案不修，待用户决策
- `+raw.endless` 接受数字字符串（如 "1e999"→Infinity 使纪录理论不可破，仅手工构造存档可触发）——留待后续收紧
- 详见 `doc/reports/` 最新报告的"记录在案"与附注章节
