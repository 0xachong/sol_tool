export interface WalletInfo {
    address: string;
    publicKey: string;
    connected: boolean;
}

export interface AccountInfo {
    address: string;
    lamports: number;
    owner: string;
    executable: boolean;
    rentEpoch: number;
}

export interface RentInfo {
    accountAddress: string;
    rentAmount: number;
    canClose: boolean;
    closeAmount: number;
}

export interface TransactionResult {
    success: boolean;
    signature?: string;
    error?: string;
}

export interface WalletAdapter {
    connect(): Promise<WalletInfo>;
    disconnect(): Promise<void>;
    signTransaction(transaction: any): Promise<any>;
    signAllTransactions(transactions: any[]): Promise<any[]>;
}
