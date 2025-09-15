import { WalletAdapter, WalletInfo } from '../types';

declare global {
    interface Window {
        okxwallet?: {
            solana?: {
                connect(): Promise<{ publicKey: { toString(): string } }>;
                disconnect(): Promise<void>;
                signTransaction(transaction: any): Promise<any>;
                signAllTransactions(transactions: any[]): Promise<any[]>;
                isConnected: boolean;
                publicKey: { toString(): string } | null;
            };
        };
    }
}

export class OKXWalletAdapter implements WalletAdapter {
    private wallet: any = null;

    constructor() {
        this.wallet = window.okxwallet?.solana;
    }

    /**
     * 检查OKX钱包是否可用
     */
    isAvailable(): boolean {
        return !!this.wallet;
    }

    /**
     * 连接OKX钱包
     */
    async connect(): Promise<WalletInfo> {
        if (!this.isAvailable()) {
            throw new Error('OKX钱包未安装或不可用');
        }

        try {
            const response = await this.wallet.connect();
            const publicKey = response.publicKey.toString();

            return {
                address: publicKey,
                publicKey: publicKey,
                connected: true,
            };
        } catch (error) {
            console.error('连接OKX钱包失败:', error);
            throw new Error(`连接OKX钱包失败: ${error}`);
        }
    }

    /**
     * 断开OKX钱包连接
     */
    async disconnect(): Promise<void> {
        if (!this.isAvailable()) {
            throw new Error('OKX钱包未安装或不可用');
        }

        try {
            await this.wallet.disconnect();
        } catch (error) {
            console.error('断开OKX钱包失败:', error);
            throw new Error(`断开OKX钱包失败: ${error}`);
        }
    }

    /**
     * 签名交易
     */
    async signTransaction(transaction: any): Promise<any> {
        if (!this.isAvailable()) {
            throw new Error('OKX钱包未安装或不可用');
        }

        if (!this.wallet.isConnected) {
            throw new Error('钱包未连接');
        }

        try {
            return await this.wallet.signTransaction(transaction);
        } catch (error) {
            console.error('签名交易失败:', error);
            throw new Error(`签名交易失败: ${error}`);
        }
    }

    /**
     * 批量签名交易
     */
    async signAllTransactions(transactions: any[]): Promise<any[]> {
        if (!this.isAvailable()) {
            throw new Error('OKX钱包未安装或不可用');
        }

        if (!this.wallet.isConnected) {
            throw new Error('钱包未连接');
        }

        try {
            return await this.wallet.signAllTransactions(transactions);
        } catch (error) {
            console.error('批量签名交易失败:', error);
            throw new Error(`批量签名交易失败: ${error}`);
        }
    }

    /**
     * 获取当前连接状态
     */
    isConnected(): boolean {
        return this.wallet?.isConnected || false;
    }

    /**
     * 获取当前公钥
     */
    getPublicKey(): string | null {
        return this.wallet?.publicKey?.toString() || null;
    }

    /**
     * 监听钱包状态变化
     */
    onAccountChange(callback: (publicKey: string | null) => void): () => void {
        if (!this.isAvailable()) return () => { };

        // OKX钱包的账户变化监听
        window.addEventListener('okxwallet#initialized', () => {
            this.wallet = window.okxwallet?.solana;
        });

        // 监听连接状态变化
        const checkConnection = () => {
            const publicKey = this.wallet?.publicKey?.toString() || null;
            callback(publicKey);
        };

        // 定期检查连接状态
        const interval = setInterval(checkConnection, 1000);

        // 返回清理函数
        return () => {
            clearInterval(interval);
        };
    }
}
