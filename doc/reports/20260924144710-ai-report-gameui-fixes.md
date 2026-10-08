# AI 对抗 Review 报告：游戏 UI 缺陷修复（弹丸消失/结算竞态/无尽丢分/星星泄漏）

- 日期：2026-09-24
- 触发改动：修复 3 个已确认缺陷 + 关卡 UI 排查发现的 2 个问题（共 8 处改动）
  - `js/game.js`：① 移除死引用 hudCombo（HTML 无此 ID）；② loadLevel 清空 particles/popups；③ 新增 settleEndless() 无尽成绩收尾；④ loadEndless 先落盘再重置 + 清空 stars/particles/popups；⑤ endShot 650ms 回调加结算浮层守卫（防双重结算）；⑥ leaveToSelect 无尽落盘 + 自动结算提示移至 showScreen 之后；⑦ 主循环结算浮层期间暂停物理与计时；⑧ draw 中 settle 期间继续绘制弹丸（防左下角瞬间消失）
  - `style.css`：#hint z-index 9→25（自动结算提示在选关屏可见）
- 基准 commit：f5a02f0（Initial commit；游戏源码本为未跟踪状态，基准为修复前工作区，已用 A/B 临时还原法对照验证）
- 状态：PASS
- 需求基准：任务描述（诊断转修复：3 个已复现缺陷 + 帧取证确认的 UI 问题清单）
- 审查方式：requirement-adversary 未派（转修复降级，见下）+ implementation-adversary（只读子代理）
- 自测基线：node --check 通过；`node test/physics.test.js` 全量通过；Node DOM 冒烟测试通过；4 个专项验证脚本（fix1/fix2b/fix3/bugs）全绿；真实浏览器（无头 Edge）验证提示可见性

## 一、需求对抗结论

### 阶段 A：需求漏洞清单（开发前）

转修复，阶段 A 降级（诊断回合已确立需求基准：缺陷现象 + 根因 + 帧级证据）。
修复方案自检：5 个修复均为最小定点改动，无需求歧义。

### 阶段 C：实现核对（可选）

| 需求要点 | 判定 | 证据（文件:行号） | 偏差说明 |
| --- | --- | --- | --- |
| 星星泄漏修复 | ✅ | js/game.js loadEndless G.stars=[] | bugs.js 复现脚本验证 |
| 自动结算提示可见 | ✅ | js/game.js leaveToSelect + style.css z-index | Node + 真实浏览器双重验证 |
| 无尽中途退出不丢分 | ✅ | js/game.js settleEndless | A/B：修复前 localStorage 空，修复后落盘 |
| 弹丸不瞬间消失 | ✅ | js/game.js:798 settle 期绘制 | A/B：修复前 0 帧，修复后持续渲染 |
| 无双重结算 | ✅ | js/game.js endShot 守卫 | A/B：修复前 1→2 次，修复后保持 1 |

## 二、实现对抗发现

| # | 严重度 | 维度 | 位置 | 问题 | 复现与证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 🟠 | 并发/异常 | game.js endShot/frame | 慢镜头期弹结算浮层 → 冻结使 endShot 的 timeScale=1 永不执行 → 重开后全程 0.39 倍速（子步/帧 1.55 vs 正常 4.00）。系改动⑤+⑦联合引入的回归 | adv1b.js 复现：慢镜头期 btnFinish→Esc→重进 | 已修复（resetShot 复位 timeScale） |
| 2 | 🟠 | 数据 | game.js loadSave | 脏档 `{"endless":"99x"}` → HUD「最高」NaN + 新纪录永远无法落盘（既有问题） | adv2.js 复现 | 已修复（loadSave 归一化） |
| 3 | 🟡 | 代码审查 | game.js draw | settle 中途 Esc 回选关后，选关屏仍绘制残留弹丸（改动⑧扩大窗口） | adv3.js 复现：Esc 后 5/5 帧仍绘制 | 已修复（draw 门控 screen==='play'） |
| 4 | 🔵 | 代码审查 | game.js loadLevel | 锁定早退路径 setHint 在 showScreen 之前（与修复⑥同类漏改，现为死路径） | 代码审读 | 已修复（两行对调） |
| 5 | 🔵 | 异常 | game.js settleEndless | 刷新/关标签页仍丢无尽当局成绩（无 beforeunload 落盘），属需求覆盖缺口 | 代码审读 | 记录在案不修（超本次范围，待用户决策） |

## 三、自动化测试结果

| 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- |
| node test/physics.test.js（全量 3 连） | 3 次全绿 | 3/3 PASS | ✅ |
| **test/ui.test.js（新增入库，3 连）** | 7 组用例 3 次全绿 | 21/21 PASS | ✅ |
| ui.test.js 用例 6 判别力验证 | 移除修复后应 FAIL | 1.80 步/帧 FAIL / 有修复 4.00 PASS | ✅ 判别力成立 |
| Node DOM 冒烟（完整流程，%TEMP% 辅助脚本） | 无崩溃 | 通过 | ✅（不入库，已被 ui.test.js 取代） |

## 四、汇总判定

- 发现统计：🔴×0 ｜ 🟠×2 ｜ 🟡×1 ｜ 🔵×2 ｜ 需求 ❌×0 ｜ ⚠️×0
- 判定：✅ PASS（R2 复审：4/4 修复确认，4 处修复均未引入回归）
- 修复责任：Main Agent（对抗审查者不改代码）
- 测试盲区处置：审查员指出「game.js 全文件零仓库内测试」→ 已新增 test/ui.test.js（7 组用例）固化全部攻击用例入库；style.css 层级断言仍缺（残余盲区，风险低）

## 五、复审记录（每轮追加——第 1 行为初审全量攻击，跨会话轮次从此表恢复）

| 轮次 | 本轮动作/修复摘要 | 复审结果 |
| --- | --- | --- |
| 1 | 初审全量攻击（7 维度，4 条独立复现链）；Main Agent 修复 #1（resetShot 复位 timeScale）#2（loadSave 归一化）#3（draw 门控 play 屏）#4（锁定提示顺序），新增 test/ui.test.js 固化攻击用例，双套件 3 连绿 | 待 R2 复审 |
| 2 | R2 独立复审（新上下文，范围收窄：验证 #1~#4 + 回归攻击 4 处波及面）：#1~#4 全部 ✅（入口完备性/15 场景脏档矩阵/双阶段绘制实证/死路径标注）；回归攻击未发现问题（timeScale 写入点全仓 3 处穷举、swing 期可证恒 1）；ui.test.js 单跑 11/11 绿 | ✅ PASS |

**R2 附注（不计入发现）**：`+raw.endless` 接受数字字符串（"1e999"→Infinity 理论上使纪录永不可破），仅手工构造存档可触发，且修复前字符串形态同样阻断比较——非本次回归，留待后续如需再收紧为 `Number.isFinite` 校验。
