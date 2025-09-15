import React, { useState } from 'react';
import { WalletInfo } from '../types';
import { SolanaUtils } from '../utils/solana';
import { OKXWalletAdapter } from '../utils/okxWallet';
import { WalletConnection } from './WalletConnection';

interface BatchWalletManagerProps {
    walletInfo: WalletInfo | null;
    onWalletConnect: (info: WalletInfo) => void;
    onWalletDisconnect: () => void;
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

export const BatchWalletManager: React.FC<BatchWalletManagerProps> = ({ walletInfo, onWalletConnect, onWalletDisconnect }) => {
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

            // 验证私钥长度（Base58编码的Solana私钥通常是88个字符）
            if (privateKey.length < 80 || privateKey.length > 100) {
                throw new Error(`私钥长度不正确，应该是88个字符左右，当前: ${privateKey.length}`);
            }

            // 尝试base58解码
            const secretKey = bs58.default.decode(privateKey);

            // 验证解码后的长度（应该是64字节）
            if (secretKey.length !== 64) {
                throw new Error(`解码后私钥长度不正确，应该是64字节，当前: ${secretKey.length}`);
            }

            const keypair = Keypair.fromSecretKey(secretKey);
            return keypair.publicKey.toString();
        } catch (err) {
            throw new Error(`Base58私钥格式错误: ${privateKey.slice(0, 8)}... (${err instanceof Error ? err.message : '未知错误'})`);
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

    // 批量回收所有钱包（分批处理避免交易过大）
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

            // 检查代付钱包余额
            const payerAccount = await solanaUtils['connection'].getAccountInfo(new PublicKey(walletInfo.address));
            const payerBalance = payerAccount ? payerAccount.lamports : 0;
            console.log(`代付钱包当前余额: ${solanaUtils.formatSOL(payerBalance)} SOL`);

            let totalSolRecovered = 0;
            let totalRentRecovered = 0;
            let successCount = 0;
            let failedCount = 0;
            const maxInstructionsPerTransaction = 18; // 每笔交易最多20个指令

            // 收集所有需要处理的指令和签名者
            const allInstructions = [];
            const allSigners = new Map(); // 存储私钥对应的签名者

            for (const walletData of walletDataList) {
                try {
                    // 为每个钱包创建签名者
                    const { Keypair } = await import('@solana/web3.js');
                    const bs58 = await import('bs58');
                    const secretKey = bs58.default.decode(walletData.privateKey);
                    const keypair = Keypair.fromSecretKey(secretKey);
                    allSigners.set(walletData.publicKey, keypair);
                    console.log(`创建签名者: ${walletData.publicKey.slice(0, 8)}... -> ${keypair.publicKey.toString().slice(0, 8)}...`);

                    // 添加零余额Token账户关闭指令
                    for (const token of walletData.zeroBalanceTokens) {
                        allInstructions.push({
                            type: 'closeToken',
                            instruction: new TransactionInstruction({
                                keys: [
                                    { pubkey: new PublicKey(token.address), isSigner: false, isWritable: true }, // token账户
                                    { pubkey: new PublicKey(walletInfo.address), isSigner: false, isWritable: true }, // 代付地址（接收rent）
                                    { pubkey: new PublicKey(walletData.publicKey), isSigner: true, isWritable: false }, // 该token账户的owner，必须isSigner: true
                                ],
                                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                                data: Buffer.from([9, 0, 0, 0]),
                            }),
                            rentAmount: token.rentAmount,
                            signer: walletData.publicKey
                        });
                    }

                    successCount++;
                    console.log(`准备钱包 ${walletData.publicKey.slice(0, 8)}... 的回收指令`);
                    // 使用getMinimumBalanceForRentExemption获取最低租金
                    // const minRent = await solanaUtils['connection'].getMinimumBalanceForRentExemption(0);
                    // 直接转移全部资金，不考虑租金豁免
                    const minRent = 0;
                    // 添加SOL转账指令（如果有余额）
                    if (walletData.solBalance > minRent) {
                        const transferAmount = walletData.solBalance - minRent;
                        allInstructions.push({
                            type: 'transfer',
                            instruction: SystemProgram.transfer({
                                fromPubkey: new PublicKey(walletData.publicKey),
                                toPubkey: new PublicKey(walletInfo.address),
                                lamports: transferAmount,
                            }),
                            solAmount: transferAmount,
                            signer: walletData.publicKey
                        });
                    }
                } catch (err) {
                    failedCount++;
                    console.error(`处理钱包 ${walletData.publicKey} 失败:`, err);
                }
            }

            if (allInstructions.length === 0) {
                setError('没有可回收的资产');
                return;
            }

            console.log(`总共需要处理 ${allInstructions.length} 个指令，将分批处理`);

            // 分批处理指令
            const batches = [];
            for (let i = 0; i < allInstructions.length; i += maxInstructionsPerTransaction) {
                batches.push(allInstructions.slice(i, i + maxInstructionsPerTransaction));
            }

            console.log(`将分 ${batches.length} 批处理`, batches);

            // 计算所需的网络费用（更实际的估算）
            const estimatedFeePerTransaction = 5000; // 每笔交易基础费用
            const safetyBuffer = 0; // 减少安全缓冲
            const totalRequiredFee = (estimatedFeePerTransaction + safetyBuffer) * batches.length;

            console.log(`预估网络费用: ${solanaUtils.formatSOL(totalRequiredFee)} SOL (${batches.length} 笔交易)`);
            console.log(`代付钱包余额: ${solanaUtils.formatSOL(payerBalance)} SOL`);
            console.log(`余额检查: ${payerBalance >= totalRequiredFee ? '✅ 足够' : '❌ 不足'}`);

            // 检查代付钱包余额是否足够（除非用户选择跳过）
            if (payerBalance < totalRequiredFee) {
                const shortfall = totalRequiredFee - payerBalance;
                setError(
                    `代付钱包余额不足！\n\n` +
                    `📊 费用分析：\n` +
                    `• 代付钱包余额: ${solanaUtils.formatSOL(payerBalance)} SOL\n` +
                    `• 预估网络费用: ${solanaUtils.formatSOL(totalRequiredFee)} SOL\n` +
                    `• 交易批次数: ${batches.length} 批\n` +
                    `• 每批费用: ${solanaUtils.formatSOL(estimatedFeePerTransaction + safetyBuffer)} SOL\n` +
                    `• 不足金额: ${solanaUtils.formatSOL(shortfall)} SOL\n\n` +
                    `💡 建议：向代付钱包充值至少 ${solanaUtils.formatSOL(shortfall)} SOL 后重试`
                );
                return;
            }

            // 处理每一批
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                console.log(`处理第 ${batchIndex + 1}/${batches.length} 批，包含 ${batch.length} 个指令`);

                const transaction = new Transaction();
                const requiredSigners = new Set(); // 收集当前批次需要的签名者

                // 添加当前批次的指令
                for (const instructionData of batch) {
                    transaction.add(instructionData.instruction);

                    // 收集需要的签名者
                    if (instructionData.signer) {
                        requiredSigners.add(instructionData.signer);
                    }

                    if (instructionData.type === 'transfer' && instructionData.solAmount) {
                        totalSolRecovered += instructionData.solAmount;
                    } else if (instructionData.type === 'closeToken' && instructionData.rentAmount) {
                        totalRentRecovered += instructionData.rentAmount;
                    }
                }

                // 设置交易参数
                const { blockhash } = await solanaUtils['connection'].getLatestBlockhash();
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = new PublicKey(walletInfo.address);

                // 调试交易信息
                console.log(`第 ${batchIndex + 1} 批交易详情:`);
                console.log(`- 指令数量: ${transaction.instructions.length}`);
                console.log(`- 需要签名者: ${Array.from(requiredSigners).map(pk => (pk as string).slice(0, 8) + '...').join(', ')}`);
                // console.log(`- 交易大小: ${transaction.serialize().length} 字节`);
                console.log(`- 费用支付者: ${walletInfo.address}`);
                console.log(`- 区块哈希: ${blockhash}`);

                // 签名并发送交易
                console.log(`正在签名第 ${batchIndex + 1} 批交易...`);

                // 添加所有需要的签名者
                const signers = Array.from(requiredSigners).map(pubkey => allSigners.get(pubkey)).filter(Boolean);
                console.log(`- 签名者数量: ${signers.length}`);
                console.log(`- 需要的签名者: ${Array.from(requiredSigners).join(', ')}`);
                console.log(`- 找到的签名者: ${signers.map(s => s.publicKey.toString()).join(', ')}`);

                // 检查是否所有需要的签名者都找到了
                const missingSigners = Array.from(requiredSigners).filter(pubkey => !allSigners.has(pubkey));
                if (missingSigners.length > 0) {
                    console.error(`❌ 缺少签名者: ${missingSigners.join(', ')}`);
                    throw new Error(`缺少签名者: ${missingSigners.join(', ')}`);
                }

                // 先添加所有需要的签名者到交易中
                for (const signer of signers) {
                    console.log(`- 添加签名者: ${signer.publicKey.toString().slice(0, 8)}...`);
                    transaction.partialSign(signer);
                }
                console.log('instructions', allInstructions)
                console.log('transaction', transaction);
                // 最后用OKX钱包签名（作为费用支付者）
                console.log(`- 使用OKX钱包签名作为费用支付者...`);
                const signedTransaction = await walletAdapter.signTransaction(transaction);

                // 验证签名
                console.log(`- 交易签名数量: ${signedTransaction.signatures.length}`);
                console.log(`- 签名者公钥: ${signedTransaction.signatures.map((sig: any) => sig.publicKey.toString()).join(', ')}`);

                console.log(`正在发送第 ${batchIndex + 1} 批交易...`);
                const signature = await solanaUtils['connection'].sendRawTransaction(signedTransaction.serialize());

                console.log(`等待第 ${batchIndex + 1} 批交易确认...`);
                await solanaUtils['connection'].confirmTransaction(signature, 'confirmed');

                console.log(`第 ${batchIndex + 1} 批交易完成，签名: ${signature}`);
            }

            setRecoveryResult({
                success: successCount,
                failed: failedCount,
                totalSol: totalSolRecovered,
                totalRent: totalRentRecovered
            });

            setSuccess(`批量回收成功！分 ${batches.length} 批处理，回收SOL: ${solanaUtils.formatSOL(totalSolRecovered)}，回收租金: ${solanaUtils.formatSOL(totalRentRecovered)}`);

            console.log(`批量回收完成！总共处理了 ${batches.length} 批交易`);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '批量回收失败';
            setError(`批量回收失败: ${errorMessage}`);
            if (err instanceof Error && err.stack) {
                // 打印详细的错误堆栈信息，并输出出错的具体行号
                if (err.stack) {
                    const stackLines = err.stack.split('\n');
                    stackLines.forEach((line, idx) => {
                        // 尝试匹配行号信息
                        const match = line.match(/:(\d+):\d+\)?$/);
                        if (match) {
                            const lineNumber = match[1];
                            console.error(`堆栈[${idx}]: ${line.trim()} (出错行号: ${lineNumber})`);
                        } else {
                            console.error(`堆栈[${idx}]: ${line.trim()}`);
                        }
                    });
                } else {
                    console.error('批量回收失败，未获取到堆栈信息');
                }
            } else {
                console.error('批量回收失败:', err);
            }
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
            {/* 页面头部 - 标题和钱包连接 */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '20px'
            }}>
                <div style={{ flex: '1', minWidth: '300px' }}>
                    <h2>🔑 批量钱包管理器</h2>
                    <p>批量管理多个私钥钱包，使用OKX连接的钱包作为代付地址回收所有资产</p>
                </div>
                <div style={{ minWidth: '300px', maxWidth: '400px' }}>
                    <WalletConnection
                        onWalletConnect={onWalletConnect}
                        onWalletDisconnect={onWalletDisconnect}
                        walletInfo={walletInfo}
                    />
                </div>
            </div>

            {/* 代付地址信息 */}
            {walletInfo && (
                <div style={{
                    backgroundColor: '#e8f4fd',
                    border: '1px solid #b3d9ff',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ margin: '0 0 8px 0', color: '#0066cc' }}>💳 代付和sol余额接收地址</h3>
                    <div style={{ fontFamily: 'monospace', fontSize: '14px', color: '#333' }}>
                        {walletInfo.address}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        所有回收的SOL和租金将转入此地址，此地址将代付所有网络费用
                    </div>
                    <div style={{ fontSize: '12px', color: '#ff6b35', marginTop: '8px', fontWeight: 'bold' }}>
                        ⚠️ 请确保代付地址有足够的SOL余额支付网络费用
                    </div>
                </div>
            )}

            {/* 私钥输入 */}
            <div style={{ marginBottom: '20px' }}>
                <h3>1. 私钥输入</h3>
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
                    支持格式：Base58私钥（88字符）、[Base58私钥,公钥]格式等
                </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ marginBottom: '20px' }}>
                <h3>2. 操作控制</h3>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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
                        3. 钱包数据 ({walletDataList.length} 个)
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
                    <h3 style={{ margin: '0 0 12px 0' }}>4. 回收结果</h3>
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
                    <li><strong>重要提醒：</strong> 本程序只回收零余额token账户,如果有token余额或NFT请谨慎操作,避免操作不当销毁资产</li>
                    <li><strong>私钥安全：</strong> 请确保在安全环境中输入Base58格式私钥，不要在不信任的设备上使用</li>
                    <li><strong>代付机制：</strong> OKX连接的钱包将代付所有网络费用，回收的资产转入该钱包</li>
                    <li><strong>余额要求：</strong> 代付钱包必须有足够的SOL余额支付所有网络费用，系统会预先检查</li>
                    <li><strong>分批处理：</strong> 自动分批处理大量指令，避免交易过大错误，每批最多20个指令</li>
                    <li><strong>权限要求：</strong> 私钥对应的钱包必须是Token账户的所有者</li>
                    <li><strong>不可撤销：</strong> 回收操作无法撤销，请确认后再执行</li>
                </ul>
            </div>
        </div>
    );
};
