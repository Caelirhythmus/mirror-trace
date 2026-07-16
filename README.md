# Mirror Trace — 路径临摹

一个基于 Canvas 的路径临摹练习工具。左侧显示随机生成的参考曲线，右侧供用户临摹绘制，系统自动计算空间相似度与时间消耗分。

## 功能

### 四种练习模式

| 模式 | 说明 |
|---|---|
| **概括** | 复杂曲线分段匹配。自由分段临摹，覆盖率 ≥97% 时触发全评价 |
| **单笔** | 单条弧线，一次绘制即完成完整评分 |
| **多条** | 多条独立的简单曲线（直线 + 弧线），逐条覆盖 |
| **地狱** | 直线 + 弧线 + 复杂曲线自由配比，复杂曲线支持段级匹配 |

### 评分体系

- **空间分**（65%）：普鲁克分析（平移对齐）+ 95% 豪斯多夫距离
- **时间分**（35%）：负指数衰减，速度越快分越高
- **KD-Tree** 加速空间评分中的最近邻查询

### 导出

- **SVG** — 参考线 + 用户笔触导出为矢量图
- **PNG** — 合并两个画布导出为位图
- **练习报告** — 文本报告含总分、各维度、历史记录

### 其他

- 可开关的画布辅助网格（密度可调）
- 笔锋模拟（压力→线宽，倾斜→透明度）
- 覆盖进度条 + 历史 sparkline
- 撤销 / 重做（Ctrl+Z / Ctrl+Y）
- 一键预设（地狱 5-3-2 / 快速 2 条 / …）
- 键盘快捷键帮助（`?` 键）
- 本地存储持久化历史记录

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 | **TypeScript** (strict mode) |
| 构建 | **Vite** 8.x |
| 测试 | **Vitest** 4.x + **happy-dom** |
| 运行时 | Canvas 2D API |
| 算法 | RDP 简化（迭代栈）、普鲁克分析、KD-Tree、等距重采样 |

### 项目结构

```
src/
├── main.ts             入口 (17 行)
├── app.ts              应用主类（生命周期、状态、事件处理）
├── input.ts            指点事件处理（clientToCanvas、drawSegment）
├── renderer.ts         画布绘制（参考线、热力图、用户笔画）
├── history-manager.ts  历史 sparkline + 列表渲染
├── exporter.ts         SVG / PNG / 报告导出
├── presets.ts          配置预设定义
├── scoring.ts          评分 + KD-Tree
├── trajectory.ts       RDP 简化 + 等距重采样
├── matching.ts         分段匹配
├── storage.ts          localStorage 持久化
├── types.ts            类型定义
├── style.css           样式
└── *.test.ts           测试 (77 项)
```

### 测试覆盖

```
算法层:  scoring(8) + trajectory(14) + matching(6) + generator(27) = 55
集成层:  main.test(22) = 22
总计:    77 项测试
```

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器
npm test           # 运行测试
npm run build      # 生产构建
```

## 许可证

MIT
