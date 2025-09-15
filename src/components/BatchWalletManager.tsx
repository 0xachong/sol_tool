import React, { useState } from 'react';
import { WalletInfo } from '../types';
import { SolanaUtils } from '../utils/solana';
import { OKXWalletAdapter } from '../utils/okxWallet';

interface BatchWalletManagerProps {
    walletInfo: WalletInfo | null;
}

interface WalletData {
    privateKey: string;
    publicKey: string;
    solBalance: number;
    solFormatted: string;
    zeroBalanceTokens: Array<{
        address: string;
        rentAmount: number;
        rentFormatted: string;
    }>;
    totalRent: number;
    totalRentFormatted: string;
}

export const BatchWalletManager: React.FC<BatchWalletManagerProps> = ({ walletInfo }) => {
    const [privateKeys, setPrivateKeys] = useState<string>('');
    const [walletDataList, setWalletDataList] = useState<WalletData[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [recoveryResult, setRecoveryResult] = useState<{
        success: number;
        failed: number;
        totalSol: number;
        totalRent: number;
    } | null>(null);

    const solanaUtils = React.useMemo(() => new SolanaUtils(), []);
    const walletAdapter = React.useMemo(() => new OKXWalletAdapter(), []);

    // 解析私钥输入（支持base58格式）
    const parsePrivateKeys = (input: string): string[] => {
        return input
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                // 支持多种格式：纯base58私钥、[私钥,公钥]格式等
                if (line.includes(',')) {
                    return line.split(',')[0].trim();
                }
                return line;
            });
    };

    // 从base58私钥生成公钥
    const getPublicKeyFromPrivateKey = async (privateKey: string): Promise<string> => {
        try {
            const { Keypair } = await import('@solana/web3.js');
            const bs58 = await import('bs58');

            // 尝试base58解码
            const secretKey = bs58.default.decode(privateKey);
            const keypair = Keypair.fromSecretKey(secretKey);
            return keypair.publicKey.toString();
        } catch (err) {
            throw new Error(`Base58私钥格式错误: ${privateKey.slice(0, 8)}...`);
        }
    };

    // 扫描单个钱包
    const scanWallet = async (privateKey: string): Promise<WalletData> => {
        const { PublicKey } = await import('@solana/web3.js');

        try {
            const publicKey = await getPublicKeyFromPrivateKey(privateKey);
            const walletPublicKey = new PublicKey(publicKey);

            // 获取SOL余额
            const accountInfo = await solanaUtils['connection'].getAccountInfo(walletPublicKey);
            const solBalance = accountInfo ? accountInfo.lamports : 0;
            const solFormatted = solanaUtils.formatSOL(solBalance);

            // 获取零余额Token账户
            const zeroBalanceTokens = [];
            try {
                const tokenAccounts = await solanaUtils['connection'].getTokenAccountsByOwner(
                    walletPublicKey,
                    {
                        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
                    }
                );

                for (const accountInfo of tokenAccounts.value) {
                    try {
                        const accountData = accountInfo.account.data;
                        const tokenAmount = accountData.readBigUInt64LE(64);

                        if (tokenAmount === 0n) {
                            zeroBalanceTokens.push({
                                address: accountInfo.pubkey.toString(),
                                rentAmount: accountInfo.account.lamports,
                                rentFormatted: solanaUtils.formatSOL(accountInfo.account.lamports)
                            });
                        }
                    } catch (err) {
                        console.warn('解析Token账户失败:', err);
                    }
                }
            } catch (err) {
                console.warn('获取Token账户失败:', err);
            }

            const totalRent = zeroBalanceTokens.reduce((sum, token) => sum + token.rentAmount, 0);

            return {
                privateKey,
                publicKey,
                solBalance,
                solFormatted,
                zeroBalanceTokens,
                totalRent,
                totalRentFormatted: solanaUtils.formatSOL(totalRent)
            };
        } catch (err) {
            throw new Error(`扫描钱包失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
    };

    // 扫描所有钱包
    const scanAllWallets = async () => {
        if (!privateKeys.trim()) {
            setError('请输入私钥列表');
            return;
        }

        setIsScanning(true);
        setError(null);
        setSuccess(null);
        setWalletDataList([]);

        try {
            const privateKeyList = parsePrivateKeys(privateKeys);
            console.log(`开始扫描 ${privateKeyList.length} 个钱包...`);

            const walletDataList: WalletData[] = [];

            for (let i = 0; i < privateKeyList.length; i++) {
                const privateKey = privateKeyList[i];
                try {
                    console.log(`扫描钱包 ${i + 1}/${privateKeyList.length}...`);
                    const walletData = await scanWallet(privateKey);
                    walletDataList.push(walletData);
                } catch (err) {
                    console.error(`钱包 ${i + 1} 扫描失败:`, err);
                    // 继续扫描其他钱包
                }
            }

            setWalletDataList(walletDataList);

            const totalSol = walletDataList.reduce((sum, wallet) => sum + wallet.solBalance, 0);
            const totalRent = walletDataList.reduce((sum, wallet) => sum + wallet.totalRent, 0);
            const totalTokens = walletDataList.reduce((sum, wallet) => sum + wallet.zeroBalanceTokens.length, 0);

            setSuccess(`扫描完成！找到 ${walletDataList.length} 个钱包，总SOL: ${solanaUtils.formatSOL(totalSol)}，可回收租金: ${solanaUtils.formatSOL(totalRent)}，零余额Token账户: ${totalTokens} 个`);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '扫描失败';
            setError(`扫描失败: ${errorMessage}`);
        } finally {
            setIsScanning(false);
        }
    };

    // 批量回收所有钱包
    const recoverAllWallets = async () => {
        if (!walletInfo?.address) {
            setError('请先连接OKX钱包作为代付地址');
            return;
        }

        if (walletDataList.length === 0) {
            setError('没有可回收的钱包数据');
            return;
        }

        setIsRecovering(true);
        setError(null);
        setSuccess(null);
        setRecoveryResult(null);

        try {
            const { PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js');
            const { Buffer } = await import('buffer');

            console.log(`开始批量回收 ${walletDataList.length} 个钱包...`);
            console.log(`代付地址: ${walletInfo.address}`);

            // 创建单笔交易
            const transaction = new Transaction();

            let totalSolRecovered = 0;
            let totalRentRecovered = 0;
            let successCount = 0;
            let failedCount = 0;

            // 为每个钱包添加回收指令
            for (const walletData of walletDataList) {
                try {
                    // 添加SOL转账指令（如果有余额）
                    if (walletData.solBalance > 5000) { // 保留少量SOL作为网络费用
                        const transferAmount = walletData.solBalance - 5000;
                        transaction.add(
                            SystemProgram.transfer({
                                fromPubkey: new PublicKey(walletData.publicKey),
                                toPubkey: new PublicKey(walletInfo.address),
                                lamports: transferAmount,
                            })
                        );
                        totalSolRecovered += transferAmount;
                    }

                    // 添加零余额Token账户关闭指令
                    for (const token of walletData.zeroBalanceTokens) {
                        transaction.add(
                            new TransactionInstruction({
                                keys: [
                                    { pubkey: new PublicKey(token.address), isSigner: false, isWritable: true },
                                    { pubkey: new PublicKey(walletInfo.address), isSigner: false, isWritable: true },
                                    { pubkey: new PublicKey(walletData.publicKey), isSigner: false, isWritable: false },
                                ],
                                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                                data: Buffer.from([9, 0, 0, 0]), // CloseAccount instruction
                            })
                        );
                        totalRentRecovered += token.rentAmount;
                    }

                    successCount++;
                    console.log(`添加钱包 ${walletData.publicKey.slice(0, 8)}... 的回收指令`);

                } catch (err) {
                    failedCount++;
                    console.error(`处理钱包 ${walletData.publicKey} 失败:`, err);
                }
            }

            if (transaction.instructions.length === 0) {
                setError('没有可回收的资产');
                return;
            }

            console.log(`交易包含 ${transaction.instructions.length} 个指令`);

            // 设置交易参数
            const { blockhash } = await solanaUtils['connection'].getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = new PublicKey(walletInfo.address);

            // 签名并发送交易
            console.log('正在签名交易...');
            const signedTransaction = await walletAdapter.signTransaction(transaction);

            console.log('正在发送交易...');
            const signature = await solanaUtils['connection'].sendRawTransaction(signedTransaction.serialize());

            console.log('等待交易确认...');
            await solanaUtils['connection'].confirmTransaction(signature, 'confirmed');

            setRecoveryResult({
                success: successCount,
                failed: failedCount,
                totalSol: totalSolRecovered,
                totalRent: totalRentRecovered
            });

            setSuccess(`批量回收成功！回收SOL: ${solanaUtils.formatSOL(totalSolRecovered)}，回收租金: ${solanaUtils.formatSOL(totalRentRecovered)}，签名: ${signature}`);

            console.log(`批量回收完成！签名: ${signature}`);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '批量回收失败';
            setError(`批量回收失败: ${errorMessage}`);
            console.error('批量回收失败:', err);
        } finally {
            setIsRecovering(false);
        }
    };

    const clearData = () => {
        setPrivateKeys('');
        setWalletDataList([]);
        setError(null);
        setSuccess(null);
        setRecoveryResult(null);
    };

    return (
        <div>
            <h2>🔑 批量钱包管理器</h2>
            <p>批量管理多个私钥钱包，使用OKX连接的钱包作为代付地址回收所有资产</p>

            {/* 代付地址信息 */}
            {walletInfo && (
                <div style={{
                    backgroundColor: '#e8f4fd',
                    border: '1px solid #b3d9ff',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ margin: '0 0 8px 0', color: '#0066cc' }}>💳 代付地址</h3>
                    <div style={{ fontFamily: 'monospace', fontSize: '14px', color: '#333' }}>
                        {walletInfo.address}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        所有回收的SOL和租金将转入此地址
                    </div>
                </div>
            )}

            {/* 私钥输入 */}
            <div style={{ marginBottom: '20px' }}>
                <label htmlFor="privateKeys">Base58私钥列表（每行一个）:</label>
                <textarea
                    id="privateKeys"
                    className="input"
                    value={privateKeys}
                    onChange={(e) => setPrivateKeys(e.target.value)}
                    placeholder="请输入Base58格式的私钥列表，每行一个：&#10;5K7m8n9p...&#10;3L4m5n6o...&#10;或 [私钥,公钥] 格式"
                    rows={8}
                    style={{ width: '100%', minHeight: '120px' }}
                />
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    支持格式：Base58私钥、[Base58私钥,公钥]格式等
                </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <button
                    className="btn"
                    onClick={scanAllWallets}
                    disabled={isScanning || !privateKeys.trim()}
                    style={{ backgroundColor: '#0066cc', color: 'white' }}
                >
                    {isScanning ? (
                        <>
                            <span className="loading"></span>
                            扫描中...
                        </>
                    ) : (
                        '🔍 扫描所有钱包'
                    )}
                </button>

                <button
                    className="btn btn-danger"
                    onClick={recoverAllWallets}
                    disabled={isRecovering || walletDataList.length === 0 || !walletInfo}
                >
                    {isRecovering ? (
                        <>
                            <span className="loading"></span>
                            回收中...
                        </>
                    ) : (
                        `💰 批量回收 (${walletDataList.length})`
                    )}
                </button>

                <button
                    className="btn"
                    onClick={clearData}
                    disabled={isScanning || isRecovering}
                >
                    清空
                </button>
            </div>

            {/* 钱包数据列表 */}
            {walletDataList.length > 0 && (
                <div style={{
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ margin: '0 0 16px 0' }}>
                        钱包数据 ({walletDataList.length} 个)
                    </h3>
                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        {walletDataList.map((wallet, index) => (
                            <div key={index} style={{
                                border: '1px solid #eee',
                                borderRadius: '6px',
                                padding: '12px',
                                marginBottom: '12px',
                                backgroundColor: '#f8f9fa'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#333' }}>
                                        {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-8)}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        钱包 #{index + 1}
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                                    <div>
                                        <span style={{ color: '#666' }}>SOL余额:</span>
                                        <span style={{ color: '#28a745', fontWeight: 'bold', marginLeft: '4px' }}>
                                            {wallet.solFormatted}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ color: '#666' }}>可回收租金:</span>
                                        <span style={{ color: '#ffc107', fontWeight: 'bold', marginLeft: '4px' }}>
                                            {wallet.totalRentFormatted}
                                        </span>
                                    </div>
                                </div>

                                {wallet.zeroBalanceTokens.length > 0 && (
                                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                                        零余额Token账户: {wallet.zeroBalanceTokens.length} 个
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* 总计信息 */}
                    <div style={{
                        marginTop: '16px',
                        padding: '12px',
                        backgroundColor: '#e9ecef',
                        borderRadius: '6px',
                        textAlign: 'center'
                    }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', fontSize: '14px' }}>
                            <div>
                                <div style={{ color: '#666', fontSize: '12px' }}>总SOL余额</div>
                                <div style={{ color: '#28a745', fontWeight: 'bold' }}>
                                    {solanaUtils.formatSOL(walletDataList.reduce((sum, wallet) => sum + wallet.solBalance, 0))}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: '#666', fontSize: '12px' }}>可回收租金</div>
                                <div style={{ color: '#ffc107', fontWeight: 'bold' }}>
                                    {solanaUtils.formatSOL(walletDataList.reduce((sum, wallet) => sum + wallet.totalRent, 0))}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: '#666', fontSize: '12px' }}>零余额Token</div>
                                <div style={{ color: '#6c757d', fontWeight: 'bold' }}>
                                    {walletDataList.reduce((sum, wallet) => sum + wallet.zeroBalanceTokens.length, 0)} 个
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 回收结果 */}
            {recoveryResult && (
                <div style={{
                    backgroundColor: recoveryResult.failed === 0 ? '#d4edda' : '#fff3cd',
                    border: `1px solid ${recoveryResult.failed === 0 ? '#c3e6cb' : '#ffeaa7'}`,
                    padding: '16px',
                    borderRadius: '8px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ margin: '0 0 12px 0' }}>回收结果</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', fontSize: '14px' }}>
                        <div>
                            <div style={{ color: '#666', fontSize: '12px' }}>成功钱包</div>
                            <div style={{ color: '#28a745', fontWeight: 'bold' }}>{recoveryResult.success}</div>
                        </div>
                        <div>
                            <div style={{ color: '#666', fontSize: '12px' }}>失败钱包</div>
                            <div style={{ color: '#dc3545', fontWeight: 'bold' }}>{recoveryResult.failed}</div>
                        </div>
                        <div>
                            <div style={{ color: '#666', fontSize: '12px' }}>回收SOL</div>
                            <div style={{ color: '#28a745', fontWeight: 'bold' }}>
                                {solanaUtils.formatSOL(recoveryResult.totalSol)}
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#666', fontSize: '12px' }}>回收租金</div>
                            <div style={{ color: '#ffc107', fontWeight: 'bold' }}>
                                {solanaUtils.formatSOL(recoveryResult.totalRent)}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 错误和成功消息 */}
            {error && (
                <div className="status status-error">
                    {error}
                </div>
            )}

            {success && (
                <div className="status status-success">
                    {success}
                </div>
            )}

            {/* 注意事项 */}
            <div style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', padding: '16px', borderRadius: '8px', marginTop: '20px' }}>
                <h4>⚠️ 注意事项</h4>
                <ul style={{ margin: '12px 0', paddingLeft: '20px' }}>
                    <li><strong>私钥安全：</strong> 请确保在安全环境中输入Base58格式私钥，不要在不信任的设备上使用</li>
                    <li><strong>代付机制：</strong> OKX连接的钱包将代付所有网络费用，回收的资产转入该钱包</li>
                    <li><strong>批量操作：</strong> 所有回收操作在一笔交易中完成，大幅节省网络费用</li>
                    <li><strong>权限要求：</strong> 私钥对应的钱包必须是Token账户的所有者</li>
                    <li><strong>SOL保留：</strong> 每个钱包会保留少量SOL（0.000005）作为网络费用缓冲</li>
                    <li><strong>不可撤销：</strong> 回收操作无法撤销，请确认后再执行</li>
                </ul>
            </div>
        </div>
    );
};
