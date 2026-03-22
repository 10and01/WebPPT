# AI Markdown 生成与导入指南

## 问题修复总结

本文档记录了为解决以下两个问题而进行的修改：

### 问题1: AI结果只能读取文字，需要Markdown格式并自动导入
**原状态**：用户调用AI只能获取纯文本内容，无法自动格式化和导入到网页。

**解决方案**：
1. 创建新的AI函数 `generateRichMarkdown()` 专门生成结构化Markdown
2. 添加新API端点 `POST /ai/decks/:deckId/generate-markdown`
3. 在前端添加"AI Generate Rich Markdown"功能区
4. 自动导入生成的Markdown到演示文稿中

### 问题2: "Failed to save slide"错误
**原状态**：无详细的错误日志，难以诊断问题原因。

**解决方案**：
1. 增强服务器端日志记录，记录deck ID、slide ID、elements数量
2. 改进前端错误消息，显示HTTP状态码和详细错误信息
3. 添加console.error日志便于调试

---

## 新功能使用指南

### 1. AI生成结构化Markdown内容

#### 使用流程：
1. **打开编辑器** → 确保已创建Deck和配置AI
2. **配置AI设置**：
   - 选择AI提供商（OpenAI或Anthropic）
   - 输入API Key和Model
   - 点击"Test Connection"验证
   - 点击"Save AI Config"保存配置

3. **使用AI生成功能**：
   - 在"AI Generate Rich Markdown"部分找到新功能区
   - **Topic**：输入你的主题（如"碳中和的商业模式"）
   - **Content Requirements**：输入你的内容要求（markdown格式）

#### 内容要求示例：

对于"碳中和的商业模式"主题，你可以这样输入：

```
主标题：碳中和的商业模式
副标题：从减排路径到盈利机制的系统梳理

模块一：什么是碳中和商业模式
要点：通过减碳、替碳、固碳与碳资产运营实现环保和商业双重价值
包含流程图：高碳活动 → 减排措施 → 碳核算 → 碳交易 → 收益回流

模块二：主要商业模式分类
需要5个卡片：
- 能源替代型（光伏、风电、储能等）
- 节能降耗型（工业、建筑节能等）
- 循环经济型（废弃物回收、再制造等）
- 碳资产运营型（碳核查、CCER交易等）
- 碳汇开发型（林业碳汇、农业碳汇等）

模块三：核心构成
包含四要素表格：客户、价值、收入来源、资源和合作伙伴

模块四：盈利来源
包含多个收入方式和占比对比柱状图说明

模块五：典型应用场景
包含企业实施路径和案例说明

模块六：挑战与趋势
包含挑战、趋势、总结等内容
```

### 2. AI生成的Markdown格式规则

系统会自动向AI传输以下规则。你的内容要求会被结合这些规则：

```
## Markdown 生成规则 ##
1. 用 # 开头的标题（主标题和模块标题）
2. 用 ## 或 ### 创建副标题和子章节
3. 用 - 或 * 创建列表项
4. 用 | 创建表格（如需要）
5. 用 > 创建引用块（强调重要信息）
6. 用 **粗体** 或 *斜体* 强调文本
7. 用 ### 卡片标题 来组织相关内容
8. 图表/流程图用描述性语言说明，如"[流程图：A → B → C]"
9. 要求内容清晰、层级分明、易于转换为演示幻灯片
10. 每个模块应该能独立成为一张或多张幻灯片
```

### 3. 点击"Generate & Import"

系统会：
1. 发送请求至 `POST /api/ai/decks/:deckId/generate-markdown`
2. AI生成完整的Markdown内容
3. 自动调用 `POST /api/decks/:deckId/import-markdown` 导入
4. 将生成的内容自动转换为幻灯片
5. 切换到第一张新生成的幻灯片

### 4. 导入结果

AI生成的Markdown将被解析并自动创建多张幻灯片，每个主要模块可能成为一张或多张幻灯片，具体取决于内容长度。

---

## 修改的代码文件

### 后端文件

#### 1. `packages/server/src/services/ai/gateway.ts`
- **新增函数** `generateRichMarkdown(config, topic, requirements)`
  - 接收主题和内容要求
  - 包含详细的Markdown格式化规则
  - 返回结构化的Markdown内容
  - Token限制：最高3000个 tokens（用于生成长内容）

#### 2. `packages/server/src/routes/ai.ts`
- **导入** `generateRichMarkdown` 函数
- **新增端点** `POST /ai/decks/:deckId/generate-markdown`
  - 请求体：`{ topic: string; requirements: string }`
  - 响应：`{ markdown: string }`
  - 包含适当的错误处理和日志

#### 3. `packages/server/src/routes/decks.ts`
- **改进** `PUT /decks/:deckId/slides/:slideId/elements` 端点
  - 加入详细的日志记录（deckId、slideId、elementCount）
  - 改进错误消息和调试信息

### 前端文件

#### 1. `packages/web/src/services/api.ts`
- **新增函数** `generateRichMarkdown(deckId, topic, requirements)`
  - 调用新的后端API端点
  - 处理错误响应并返回详细错误信息

- **改进函数** `replaceSlideElements()`
  - 增加console.error日志记录失败情况
  - 记录status code、deckId、slideId、elementCount等信息

#### 2. `packages/web/src/App.vue`
- **新增ref** `aiGenerateRequirements`
  - 存储用户输入的内容要求

- **新增函数** `onGenerateAndImportMarkdown()`
  - 调用 `generateRichMarkdown()` 获取Markdown
  - 自动调用 `importMarkdown()` 导入内容
  - 更新UI并切换到新slide

- **新增导入** `generateRichMarkdown` 函数导入

- **新增UI部分** "AI Generate Rich Markdown"
  - Topic输入框
  - Content Requirements文本框
  - "Generate & Import"按钮

---

## API文档

### 新增端点：POST /api/ai/decks/:deckId/generate-markdown

**请求**：
```json
{
  "topic": "碳中和的商业模式",
  "requirements": "主标题：碳中和的商业模式\n副标题：从减排路径到盈利机制\n..."
}
```

**响应（成功）**：
```json
{
  "markdown": "# 碳中和的商业模式\n\n## 从减排路径到盈利机制的系统梳理\n\n..."
}
```

**响应（失败）**：
```json
{
  "message": "AI generate markdown failed: [error details]"
}
```

**状态码**：
- 200: 成功
- 404: Deck不存在
- 502: AI生成失败

---

## 常見問題

### Q1: 如何确保AI生成的Markdown格式正确？
A: 系统会自动向AI传递详细的Markdown格式规则。确保你的requirements清晰、分层次，并包含你需要的内容类型。

### Q2: 生成失败怎么办？
A: 检查：
1. AI配置是否正确（Test Connection）
2. API Key是否有效和配额充足
3. 浏览器控制台是否有错误信息
4. 查看服务器日志获取详细错误信息

### Q3: 如何修改已导入的Markdown内容？
A: 导入后，你可以：
1. 直接在slide编辑器中编辑文本和布局
2. 添加删除幻灯片
3. 调整元素位置、大小和样式

### Q4: 支持什么样的Markdown语法？
A: 支持的语法包括：
- 标题（# ## ###）
- 列表（- * +）
- 表格（|---|）
- 引用块（>）
- 加粗和斜体（**粗体** *斜体*）

详见上方"AI生成的Markdown格式规则"部分。

---

## 测试建议

1. **基础功能测试**：
   - 输入简单的主题和requirements
   - 验证生成的Markdown是否与预期一致
   - 检查导入后是否正确创建幻灯片

2. **错误处理测试**：
   - 使用无效的API Key
   - 测试网络错误情况
   - 检查console.error日志是否正确显示

3. **内容长度测试**：
   - 测试较长的requirements（过长会被截断）
   - 验证3000 token限制是否足够

4. **集成测试**：
   - 生成内容后编辑和保存
   - 验证"Failed to save slide"是否仍然出现

---

## 后续改进建议

1. **UI改进**：
   - 显示生成进度
   - 预览生成的Markdown再导入
   - 支持多种模板选择

2. **功能扩展**：
   - 生成幻灯片设计建议
   - 支持自定义Markdown规则
   - 生成演讲稿本

3. **性能优化**：
   - 缓存已生成的内容
   - 流式传输大型Markdown
   - 支持批量生成

---

更新日期：2024年3月22日
