import { useState } from 'react';
import { WalletInfo } from './types';
import { BatchWalletManager } from './components/BatchWalletManager';

function App() {
    const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);

    const handleWalletConnect = (info: WalletInfo) => {
        setWalletInfo(info);
    };

    const handleWalletDisconnect = () => {
        setWalletInfo(null);
    };

    return (
        <div className="container">
            <div className="header">
                <h1>🔧 Solana租金回收工具</h1>
                <p>批量钱包管理与租金回收工具</p>
            </div>

            <div className="card">
                <BatchWalletManager
                    walletInfo={walletInfo}
                    onWalletConnect={handleWalletConnect}
                    onWalletDisconnect={handleWalletDisconnect}
                />
            </div>

            <div className="card">
                <h2>📖 使用说明</h2>
                <div style={{ lineHeight: '1.6' }}>
                    <h3>1. 连接钱包</h3>
                    <p>首先需要安装并连接OKX钱包，这是使用本工具的前提条件。连接的钱包将作为代付地址，用于支付所有网络费用。</p>

                    <h3>2. 批量钱包管理</h3>
                    <p>批量管理多个私钥钱包，使用OKX连接的钱包作为代付地址回收所有资产。支持批量扫描钱包余额和零余额Token账户，一键回收所有SOL和租金。</p>

                    <h3>💡 关于租金豁免（Rent Exemption）</h3>
                    <div style={{ backgroundColor: '#f8f9fa', padding: '16px', borderRadius: '8px', margin: '12px 0' }}>
                        <p><strong>什么是租金豁免？</strong></p>
                        <p>在Solana中，每个账户都需要支付"租金"来保持存储空间。如果账户有足够的余额，就可以获得"租金豁免"：</p>
                        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                            <li>账户不会被删除，即使长时间不活跃</li>
                            <li>不需要持续支付租金</li>
                            <li>账户数据永久保存在区块链上</li>
                        </ul>
                        <p><strong>租金豁免要求：</strong> 账户需要保持的最小SOL余额，由 <code>getMinimumBalanceForRentExemption</code> 计算得出。</p>
                        <p><strong>可回收金额：</strong> 当前余额 - 租金豁免要求 = 可以安全回收的SOL数量</p>
                    </div>

                    <h3>⚠️ 重要提醒</h3>
                    <ul style={{ margin: '12px 0', paddingLeft: '20px' }}>
                        <li>关闭账户操作不可逆，请谨慎操作</li>
                        <li>确保目标地址正确，避免资金损失</li>
                        <li>建议先使用租金回收分析功能了解账户状态</li>
                        <li>所有操作都需要支付网络交易费用</li>
                    </ul>
                </div>
            </div>

            <div className="card" style={{ textAlign: 'center', marginTop: '40px' }}>
                <p style={{ color: '#666', fontSize: '14px' }}>
                    Solana工具集 v1.0.0 | 基于 React + TypeScript + Solana Web3.js
                </p>
            </div>
        </div>
    );
}

export default App;
