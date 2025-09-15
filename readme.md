# Solana租金回收工具

一个用于Solana区块链的租金回收和账户管理工具，支持连接OKX钱包进行操作。

## 功能特性

- 🔗 **OKX钱包连接**: 安全连接OKX钱包进行交易签名
- 💰 **租金回收分析**: 批量分析多个账户的可回收租金
- 🗑️ **账户关闭**: 安全关闭账户并回收租金到指定地址
- 📊 **详细统计**: 提供完整的账户状态和租金信息
- 🎨 **现代UI**: 美观的用户界面和良好的用户体验

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **区块链**: Solana Web3.js
- **钱包集成**: OKX Wallet
- **样式**: CSS3 + 现代设计

## 快速开始

### 环境要求

- Node.js 16+ 
- npm 或 yarn
- OKX钱包浏览器扩展

### 安装和运行

1. 克隆项目
```bash
git clone <repository-url>
cd sol_tool
```

2. 安装依赖
```bash
npm install
```

3. 启动开发服务器
```bash
npm run dev
# 或者使用启动脚本
./start.sh
```

4. 在浏览器中打开 `http://localhost:3000`

### 构建生产版本

```bash
npm run build
```

## 使用说明

### 1. 连接钱包
- 确保已安装OKX钱包浏览器扩展
- 点击"连接OKX钱包"按钮
- 在钱包中确认连接

### 2. 租金回收分析
- 在文本框中输入要分析的账户地址（每行一个）
- 点击"分析租金"按钮
- 查看分析结果和可回收金额统计

### 3. 关闭账户
- 输入要关闭的账户地址
- 输入接收余额的目标地址
- 点击"关闭账户"按钮
- 在钱包中确认交易

## 注意事项

⚠️ **重要提醒**:
- 关闭账户操作不可逆，请谨慎操作
- 确保目标地址正确，避免资金损失
- 建议先使用租金回收分析功能了解账户状态
- 所有操作都需要支付网络交易费用

## 项目结构

```
src/
├── components/          # React组件
│   ├── WalletConnection.tsx    # 钱包连接组件
│   ├── RentRecovery.tsx        # 租金回收分析组件
│   └── AccountCloser.tsx       # 账户关闭组件
├── utils/               # 工具类
│   ├── solana.ts              # Solana区块链工具
│   └── okxWallet.ts           # OKX钱包适配器
├── types/               # TypeScript类型定义
│   └── index.ts
├── App.tsx              # 主应用组件
├── main.tsx             # 应用入口
└── index.css            # 全局样式
```

## 开发

### 代码规范
- 使用ESLint进行代码检查
- 遵循TypeScript严格模式
- 使用函数式组件和Hooks

### 贡献
欢迎提交Issue和Pull Request来改进这个项目。

## 许可证

MIT License