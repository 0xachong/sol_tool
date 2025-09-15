import React, { useState, useEffect } from 'react';
import { WalletInfo } from '../types';
import { OKXWalletAdapter } from '../utils/okxWallet';

interface WalletConnectionProps {
    onWalletConnect: (walletInfo: WalletInfo) => void;
    onWalletDisconnect: () => void;
    walletInfo: WalletInfo | null;
}

export const WalletConnection: React.FC<WalletConnectionProps> = ({
    onWalletConnect,
    onWalletDisconnect,
    walletInfo,
}) => {
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [walletAdapter] = useState(() => new OKXWalletAdapter());

    useEffect(() => {
        // 检查钱包是否已连接
        if (walletAdapter.isConnected()) {
            const publicKey = walletAdapter.getPublicKey();
            if (publicKey) {
                onWalletConnect({
                    address: publicKey,
                    publicKey: publicKey,
                    connected: true,
                });
            }
        }

        // 监听账户变化
        const cleanup = walletAdapter.onAccountChange((publicKey) => {
            if (publicKey) {
                onWalletConnect({
                    address: publicKey,
                    publicKey: publicKey,
                    connected: true,
                });
            } else {
                onWalletDisconnect();
            }
        });

        return cleanup;
    }, [walletAdapter]); // 只依赖 walletAdapter，避免无限循环

    const handleConnect = async () => {
        if (!walletAdapter.isAvailable()) {
            setError('请先安装OKX钱包');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            const walletInfo = await walletAdapter.connect();
            onWalletConnect(walletInfo);
        } catch (err) {
            setError(err instanceof Error ? err.message : '连接失败');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            await walletAdapter.disconnect();
            onWalletDisconnect();
        } catch (err) {
            setError(err instanceof Error ? err.message : '断开连接失败');
        }
    };

    const formatAddress = (address: string) => {
        return `${address.slice(0, 4)}...${address.slice(-4)}`;
    };

    return (
        <div>

            {!walletAdapter.isAvailable() && (
                <div className="status status-error">
                    <p>请先安装 <a href="https://www.okx.com/web3" target="_blank" rel="noopener noreferrer">OKX钱包</a></p>
                </div>
            )}

            {error && (
                <div className="status status-error">
                    {error}
                </div>
            )}

            {walletInfo ? (
                <div>
                    <div className="status status-success">
                        <p>✅ 钱包已连接</p>
                        <p>地址: {formatAddress(walletInfo.address)}</p>
                    </div>
                    <button
                        className="btn btn-danger"
                        onClick={handleDisconnect}
                        disabled={isConnecting}
                    >
                        断开连接
                    </button>
                </div>
            ) : (
                <button
                    className="btn"
                    onClick={handleConnect}
                    disabled={isConnecting || !walletAdapter.isAvailable()}
                >
                    {isConnecting ? (
                        <>
                            <span className="loading"></span>
                            连接中...
                        </>
                    ) : (
                        '连接OKX钱包'
                    )}
                </button>
            )}
        </div>
    );
};
