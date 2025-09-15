import {
    Connection,
    PublicKey,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { AccountInfo, RentInfo } from '../types';

export class SolanaUtils {
    private connection: Connection;

    constructor(rpcUrl: string = 'https://mainnet.helius-rpc.com/?api-key=7dbf1c5b-a6cf-4fca-852b-4fd8a0db35c2') {
        this.connection = new Connection(rpcUrl, 'confirmed');
    }

    /**
     * 获取账户信息
     */
    async getAccountInfo(address: string): Promise<AccountInfo | null> {
        try {
            const publicKey = new PublicKey(address);
            const accountInfo = await this.connection.getAccountInfo(publicKey);

            if (!accountInfo) {
                return null;
            }

            return {
                address,
                lamports: accountInfo.lamports,
                owner: accountInfo.owner.toString(),
                executable: accountInfo.executable,
                rentEpoch: accountInfo.rentEpoch || 0,
            };
        } catch (error) {
            console.error('获取账户信息失败:', error);
            throw new Error(`获取账户信息失败: ${error}`);
        }
    }

    /**
     * 计算账户租金
     */
    async calculateRent(accountInfo: AccountInfo): Promise<number> {
        try {
            // 获取账户的实际数据大小来计算租金豁免要求
            const publicKey = new PublicKey(accountInfo.address);
            const accountData = await this.connection.getAccountInfo(publicKey);

            if (!accountData) {
                throw new Error('账户不存在');
            }

            const rentExemptAmount = await this.connection.getMinimumBalanceForRentExemption(
                accountData.data.length
            );
            return rentExemptAmount;
        } catch (error) {
            console.error('计算租金失败:', error);
            throw new Error(`计算租金失败: ${error}`);
        }
    }

    /**
     * 检查账户是否可以关闭
     */
    async canCloseAccount(accountInfo: AccountInfo): Promise<RentInfo> {
        try {
            const rentExemptAmount = await this.calculateRent(accountInfo);
            const canClose = accountInfo.lamports > rentExemptAmount;
            const closeAmount = canClose ? accountInfo.lamports - rentExemptAmount : 0;

            return {
                accountAddress: accountInfo.address,
                rentAmount: rentExemptAmount,
                canClose,
                closeAmount,
            };
        } catch (error) {
            console.error('检查账户关闭条件失败:', error);
            throw new Error(`检查账户关闭条件失败: ${error}`);
        }
    }

    /**
     * 获取账户类型信息
     */
    async getAccountTypeInfo(accountInfo: AccountInfo): Promise<{
        type: string;
        dataSize: number;
        description: string;
    }> {
        try {
            const publicKey = new PublicKey(accountInfo.address);
            const accountData = await this.connection.getAccountInfo(publicKey);

            if (!accountData) {
                return {
                    type: 'Unknown',
                    dataSize: 0,
                    description: '账户不存在'
                };
            }

            const dataSize = accountData.data.length;

            if (accountInfo.executable) {
                return {
                    type: 'Program Account',
                    dataSize,
                    description: `程序账户，数据大小: ${dataSize} bytes`
                };
            } else if (dataSize === 0) {
                return {
                    type: 'System Account',
                    dataSize,
                    description: '系统账户，无数据'
                };
            } else if (dataSize <= 32) {
                return {
                    type: 'Token Account',
                    dataSize,
                    description: `代币账户，数据大小: ${dataSize} bytes`
                };
            } else if (dataSize <= 200) {
                return {
                    type: 'Small Data Account',
                    dataSize,
                    description: `小数据账户，数据大小: ${dataSize} bytes`
                };
            } else {
                return {
                    type: 'Large Data Account',
                    dataSize,
                    description: `大数据账户，数据大小: ${dataSize} bytes`
                };
            }
        } catch (error) {
            console.error('获取账户类型信息失败:', error);
            return {
                type: 'Unknown',
                dataSize: 0,
                description: '无法确定账户类型'
            };
        }
    }

    /**
     * 创建关闭账户交易
     */
    async createCloseAccountTransaction(
        accountToClose: string,
        destination: string
    ): Promise<Transaction> {
        try {
            const transaction = new Transaction();

            // 将账户余额转移到目标地址
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(accountToClose),
                    toPubkey: new PublicKey(destination),
                    lamports: 0, // 将在签名时计算实际金额
                })
            );

            return transaction;
        } catch (error) {
            console.error('创建关闭账户交易失败:', error);
            throw new Error(`创建关闭账户交易失败: ${error}`);
        }
    }

    /**
     * 获取多个账户的租金信息
     */
    async getMultipleAccountsRentInfo(addresses: string[]): Promise<RentInfo[]> {
        try {
            const publicKeys = addresses.map(addr => new PublicKey(addr));
            const accountsInfo = await this.connection.getMultipleAccountsInfo(publicKeys);

            const results: RentInfo[] = [];

            for (let i = 0; i < addresses.length; i++) {
                const accountInfo = accountsInfo[i];
                if (accountInfo) {
                    // 直接使用账户数据大小计算租金豁免要求
                    const rentExemptAmount = await this.connection.getMinimumBalanceForRentExemption(
                        accountInfo.data.length
                    );

                    const canClose = accountInfo.lamports > rentExemptAmount;
                    const closeAmount = canClose ? accountInfo.lamports - rentExemptAmount : 0;

                    results.push({
                        accountAddress: addresses[i],
                        rentAmount: rentExemptAmount,
                        canClose,
                        closeAmount,
                    });
                }
            }

            return results;
        } catch (error) {
            console.error('获取多个账户租金信息失败:', error);
            throw new Error(`获取多个账户租金信息失败: ${error}`);
        }
    }

    /**
     * 格式化SOL数量
     */
    formatSOL(lamports: number): string {
        return (lamports / LAMPORTS_PER_SOL).toFixed(6);
    }

    /**
     * 验证地址格式
     */
    isValidAddress(address: string): boolean {
        try {
            new PublicKey(address);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取连接状态
     */
    async getConnectionStatus(): Promise<boolean> {
        try {
            await this.connection.getVersion();
            return true;
        } catch {
            return false;
        }
    }

}
