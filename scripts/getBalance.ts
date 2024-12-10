import { ethers } from 'hardhat';

const run = async () => {
    const accounts = await ethers.getSigners();
    const provider = ethers.provider;

    for (const account of accounts) {
        console.log(
            '%s (%i ETH)',
            account.address,
            ethers.formatEther(await provider.getBalance(account.address))
        );
    }
};

run();
