export const TX_FILTER_ADDRESS_VALIDATION = {
    address: {
        ethers: true,
        onChain: true,
    },
    tokenContract: {
        ethers: true,
        onChain: true,
    },
} as const;

export const ERC20_VALIDATION_ABI = [
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
] as const;
