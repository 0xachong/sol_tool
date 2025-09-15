import React, { useState, useMemo } from 'react';
import { WalletInfo, RentInfo } from '../types';
import { SolanaUtils } from '../utils/solana';

interface RentRecoveryProps {
    walletInfo: WalletInfo | null;
}

export const RentRecovery: React.FC<RentRecoveryProps> = ({ walletInfo }) => {
    const [addresses, setAddresses] = useState<string>('');
    const [rentInfo, setRentInfo] = useState<RentInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const solanaUtils = useMemo(() => new SolanaUtils(), []);

    const handleAnalyze = async () => {
        if (!addresses.trim()) {
            setError('请输入要分析的账户地址');
            return;
        }

        const addressList = addresses
            .split('\n')
            .map(addr => addr.trim())
            .filter(addr => addr.length > 0);

        if (addressList.length === 0) {
            setError('请输入有效的账户地址');
            return;
        }

        // 验证地址格式
        const invalidAddresses = addressList.filter(addr => !solanaUtils.isValidAddress(addr));
        if (invalidAddresses.length > 0) {
            setError(`以下地址格式无效: ${invalidAddresses.join(', ')}`);
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const results = await solanaUtils.getMultipleAccountsRentInfo(addressList);
            setRentInfo(results);

            const totalRecoverable = results.reduce((sum, info) => sum + info.closeAmount, 0);
            setSuccess(`分析完成！可回收租金总计: ${solanaUtils.formatSOL(totalRecoverable)} SOL`);
        } catch (err) {
            setError(err instanceof Error ? err.message : '分析失败');
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = () => {
        setAddresses('');
        setRentInfo([]);
        setError(null);
        setSuccess(null);
    };

    const totalRecoverable = rentInfo.reduce((sum, info) => sum + info.closeAmount, 0);
    const totalRent = rentInfo.reduce((sum, info) => sum + info.rentAmount, 0);

    return (
        <div>
            <p>输入要分析的Solana账户地址，系统将计算可回收的租金</p>

            <div>
                <label htmlFor="addresses">账户地址 (每行一个):</label>
                <textarea
                    id="addresses"
                    className="input"
                    rows={6}
                    value={addresses}
                    onChange={(e) => setAddresses(e.target.value)}
                    placeholder="输入Solana账户地址，每行一个&#10;例如:&#10;9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM&#10;5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"
                />
            </div>

            <div>
                <button
                    className="btn"
                    onClick={handleAnalyze}
                    disabled={isLoading || !walletInfo}
                >
                    {isLoading ? (
                        <>
                            <span className="loading"></span>
                            分析中...
                        </>
                    ) : (
                        '分析租金'
                    )}
                </button>

                <button
                    className="btn btn-danger"
                    onClick={handleClear}
                    disabled={isLoading}
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

            {rentInfo.length > 0 && (
                <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                    <h3>分析结果</h3>

                    <div className="status status-info">
                        <p><strong>总计可回收租金:</strong> {solanaUtils.formatSOL(totalRecoverable)} SOL</p>
                        <p><strong>总租金要求:</strong> {solanaUtils.formatSOL(totalRent)} SOL</p>
                        <p><strong>分析账户数:</strong> {rentInfo.length}</p>
                        <p><strong>说明:</strong> 租金要求 = 获得租金豁免的最小余额，超过此金额的部分可以回收</p>
                    </div>

                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8f9fa' }}>
                                    <th style={{ padding: '12px', border: '1px solid #dee2e6', textAlign: 'left' }}>账户地址</th>
                                    <th style={{ padding: '12px', border: '1px solid #dee2e6', textAlign: 'left' }}>当前余额</th>
                                    <th style={{ padding: '12px', border: '1px solid #dee2e6', textAlign: 'left' }}>租金豁免要求<br /><small>(最小余额)</small></th>
                                    <th style={{ padding: '12px', border: '1px solid #dee2e6', textAlign: 'left' }}>可回收金额</th>
                                    <th style={{ padding: '12px', border: '1px solid #dee2e6', textAlign: 'left' }}>状态</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rentInfo.map((info, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '12px', border: '1px solid #dee2e6', fontFamily: 'monospace', fontSize: '12px' }}>
                                            {info.accountAddress.slice(0, 8)}...{info.accountAddress.slice(-8)}
                                        </td>
                                        <td style={{ padding: '12px', border: '1px solid #dee2e6' }}>
                                            {solanaUtils.formatSOL(info.rentAmount + info.closeAmount)} SOL
                                        </td>
                                        <td style={{ padding: '12px', border: '1px solid #dee2e6' }}>
                                            {solanaUtils.formatSOL(info.rentAmount)} SOL
                                        </td>
                                        <td style={{ padding: '12px', border: '1px solid #dee2e6' }}>
                                            {solanaUtils.formatSOL(info.closeAmount)} SOL
                                        </td>
                                        <td style={{ padding: '12px', border: '1px solid #dee2e6' }}>
                                            {info.canClose ? (
                                                <span style={{ color: '#28a745', fontWeight: 'bold' }}>可关闭</span>
                                            ) : (
                                                <span style={{ color: '#dc3545' }}>不可关闭</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
