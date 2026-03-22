#!/usr/bin/env pwsh
# 快速测试脚本 - AI Markdown生成和导入功能

# 测试API端点
$ApiBase = "http://localhost:4000/api"
$DeckId = "test-deck-$(Get-Random)"

Write-Host "🧪 开始测试 AI Markdown 生成功能"
Write-Host "================================" -ForegroundColor Cyan

# 步骤1: 创建测试Deck
Write-Host "`n1️⃣  创建测试Deck..." -ForegroundColor Yellow
$createDeckResponse = @{
    title = "AI Markdown Test Deck"
    createdBy = "test-user"
} | ConvertTo-Json | curl.exe -X POST "$ApiBase/decks" `
    -H "Content-Type: application/json" `
    -d @- -s | ConvertFrom-Json

$DeckId = $createDeckResponse.deck.id
Write-Host "✅ Deck创建成功: $DeckId" -ForegroundColor Green

# 步骤2: 测试AI生成Markdown (需要先配置AI)
Write-Host "`n2️⃣  测试AI生成Markdown..." -ForegroundColor Yellow

# 构建请求体
$generateBody = @{
    topic = "碳中和的商业模式"
    requirements = @"
主标题：碳中和的商业模式
副标题：从减排路径到盈利机制的系统梳理

模块一：什么是碳中和商业模式
- 通过减碳、替碳、固碳与碳资产运营
- 实现环保和商业双重价值
- 流程图：高碳活动 → 减排措施 → 碳核算 → 碳交易

模块二：主要商业模式分类
- 能源替代型（光伏、风电、储能）
- 节能降耗型（工业、建筑节能）
- 循环经济型（废弃物回收、再制造）

模块三：商业模式核心构成
列出四要素：客户、价值、收入来源、资源

模块四：盈利来源
- 产品销售收入
- 能源服务费
- 碳信用交易收益

模块五：挑战与趋势
- 挑战：初始投资高、回报周期长
- 趋势：数字化碳管理、产业链协同
"@
} | ConvertTo-Json

Write-Host "📤 发送请求到 POST /ai/decks/$DeckId/generate-markdown" -ForegroundColor Cyan
Write-Host "主题: 碳中和的商业模式" -ForegroundColor Gray
Write-Host "需求长度: $(($generateBody | Measure-Object -Character).Characters) 字符" -ForegroundColor Gray

try {
    $generateResponse = $generateBody | curl.exe -X POST `
        "$ApiBase/ai/decks/$DeckId/generate-markdown" `
        -H "Content-Type: application/json" `
        -d @- -s -w "`nHTTP Status: %{http_code}`n"
    
    if ($generateResponse -like "*HTTP Status: 200*") {
        Write-Host "✅ AI Markdown生成成功！" -ForegroundColor Green
        
        # 提取Markdown内容（忽略HTTP Status行）
        $markdownContent = $generateResponse -replace 'HTTP Status: \d+$', ''
        Write-Host "📝 生成内容长度: $($markdownContent.Length) 字符"
        Write-Host "`n生成的Markdown预览（前500字符）：" -ForegroundColor Cyan
        Write-Host $markdownContent.Substring(0, [Math]::Min(500, $markdownContent.Length)) -ForegroundColor Gray
    } else {
        Write-Host "❌ AI Markdown生成失败" -ForegroundColor Red
        Write-Host $generateResponse -ForegroundColor Red
        Write-Host "`n💡 检查项：" -ForegroundColor Yellow
        Write-Host "  1. 是否配置了有效的AI API Key?"
        Write-Host "  2. API Key配额是否充足?"
        Write-Host "  3. 检查浏览器控制台是否有更详细的错误信息"
        exit 1
    }
} catch {
    Write-Host "❌ 请求失败: $_" -ForegroundColor Red
    exit 1
}

# 步骤3: 测试导入Markdown
Write-Host "`n3️⃣  测试导入Markdown..." -ForegroundColor Yellow

$simpleMarkdown = @"
# 测试标题

## 副标题

- 要点一
- 要点二
- 要点三

## 第二部分

- 内容A
- 内容B

### 小节

更多详细内容...
"@

$importBody = @{
    markdown = $simpleMarkdown
} | ConvertTo-Json

$importResponse = $importBody | curl.exe -X POST `
    "$ApiBase/decks/$DeckId/import-markdown" `
    -H "Content-Type: application/json" `
    -d @- -s | ConvertFrom-Json

if ($importResponse.deck) {
    Write-Host "✅ Markdown导入成功！" -ForegroundColor Green
    Write-Host "   创建的Slide数量: $($importResponse.deck.slides.Count)" -ForegroundColor Green
    Write-Host "   Deck ID: $($importResponse.deck.id)" -ForegroundColor Green
} else {
    Write-Host "❌ Markdown导入失败" -ForegroundColor Red
    Write-Host $importResponse -ForegroundColor Red
}

# 步骤4: 保存元素测试
Write-Host "`n4️⃣  测试保存Slide元素..." -ForegroundColor Yellow

if ($importResponse.deck.slides.Count -gt 0) {
    $slide = $importResponse.deck.slides[0]
    $DeckIdForSave = $importResponse.deck.id
    $SlideIdForSave = $slide.id
    
    Write-Host "   Slide ID: $SlideIdForSave"
    Write-Host "   Elements count: $($slide.elements.Count)"
    
    # 尝试保存相同的elements
    $saveBody = @{
        elements = @($slide.elements)
    } | ConvertTo-Json -Depth 10
    
    $saveResponse = $saveBody | curl.exe -X PUT `
        "$ApiBase/decks/$DeckIdForSave/slides/$SlideIdForSave/elements" `
        -H "Content-Type: application/json" `
        -d @- -s | ConvertFrom-Json
    
    if ($saveResponse.slide) {
        Write-Host "✅ Slide元素保存成功！" -ForegroundColor Green
    } else {
        Write-Host "❌ Slide元素保存失败" -ForegroundColor Red
        Write-Host "   $($saveResponse | ConvertTo-Json)" -ForegroundColor Red
    }
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "✨ 测试完成！" -ForegroundColor Green
Write-Host "`n📖 使用指南请参考: AI_MARKDOWN_GUIDE.md" -ForegroundColor Yellow
Write-Host "🌐 打开浏览器查看: http://localhost:5173/" -ForegroundColor Cyan
