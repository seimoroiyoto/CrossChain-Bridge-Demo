import {
    SwapRouter,
    UniswapTrade,
    SwapOptions
} from '@uniswap/universal-router-sdk';
import {
    TradeType,
    ChainId,
    Token,
    WETH9,
    CurrencyAmount,
    Percent
} from '@uniswap/sdk-core';
import { Route as V2RouteSDK, Pair as V2Pair } from '@uniswap/v2-sdk';
import { Route as V3RouteSDK, FeeAmount, Pool } from '@uniswap/v3-sdk';
import { Trade as RouterTrade } from '@uniswap/router-sdk';
import { ethers } from 'hardhat';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import IUniswapV2poolABI from '@uniswap/v2-core/build/IUniswapV2Pair.json';

const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545/');

const createV2Pair = async (tokenA: Token, tokenB: Token): Promise<V2Pair> => {
    const pairAddress = V2Pair.getAddress(tokenA, tokenB);

    const pairContract = new ethers.Contract(
        pairAddress,
        IUniswapV2poolABI.abi,
        provider
    );
    const reserves = await pairContract['getReserves']();
    const [reserve0, reserve1] = reserves;

    const tokens = [tokenA, tokenB];
    const [token0, token1] = tokens[0].sortsBefore(tokens[1])
        ? tokens
        : [tokens[1], tokens[0]];

    const pair = new V2Pair(
        CurrencyAmount.fromRawAmount(token0, reserve0.toString()),
        CurrencyAmount.fromRawAmount(token1, reserve1.toString())
    );
    return pair;
};

const getPoolInfo = async (tokenA: Token, tokenB: Token) => {
    const poolAddress = Pool.getAddress(tokenA, tokenB, FeeAmount.MEDIUM);
    const poolContract = new ethers.Contract(
        poolAddress,
        IUniswapV3PoolABI.abi,
        provider
    );

    const [fee, liquidity, slot0] = await Promise.all([
        poolContract.fee(),
        poolContract.liquidity(),
        poolContract.slot0()
    ]);

    return {
        fee,
        liquidity,
        sqrtPriceX96: slot0[0],
        tick: slot0[1]
    };
};

const createV3Route = async (
    tokenA: Token,
    tokenB: Token
): Promise<V3RouteSDK<Token, Token>> => {
    const poolInfo = await getPoolInfo(tokenA, tokenB);
    const pool = new Pool(
        tokenA,
        tokenB,
        FeeAmount.MEDIUM,
        poolInfo.sqrtPriceX96.toString(),
        poolInfo.liquidity.toString(),
        Number(poolInfo.tick)
    );

    return new V3RouteSDK([pool], tokenA, tokenB);
};

const createV2Route = async (
    tokenA: Token,
    tokenB: Token
): Promise<V2RouteSDK<Token, Token>> => {
    const pair = await createV2Pair(tokenA, tokenB);
    return new V2RouteSDK([pair], tokenA, tokenB);
};

const main = async (
    tokenAddress: string,
    type: 'buy' | 'sell',
    amount: string,
    wallet: string
) => {
    const DAI = new Token(ChainId.MAINNET, tokenAddress, 18);

    let tokenA: Token | undefined, tokenB: Token | undefined;
    if (type === 'buy') {
        tokenA = WETH9[DAI.chainId];
        tokenB = DAI;
    }

    if (type === 'sell') {
        tokenA = DAI;
        tokenB = WETH9[DAI.chainId];
    }

    if (tokenA && tokenB) {
        const routev2 = await createV2Route(tokenA, tokenB);
        const routev3 = await createV3Route(tokenA, tokenB);
        const options: SwapOptions = {
            slippageTolerance: new Percent(50, 10_000),
            recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
        };

        const routerTrade = new UniswapTrade(
            new RouterTrade({
                v2Routes: [
                    {
                        routev2,
                        inputAmount: CurrencyAmount.fromRawAmount(
                            tokenA,
                            amount
                        ),
                        outputAmount: CurrencyAmount.fromRawAmount(tokenB, '0')
                    }
                ],
                v3Routes: [
                    {
                        routev3,
                        inputAmount: CurrencyAmount.fromRawAmount(
                            tokenA,
                            amount
                        ),
                        outputAmount: CurrencyAmount.fromRawAmount(tokenB, '0')
                    }
                ],
                tradeType: TradeType.EXACT_INPUT
            }),
            options
        );
        const { calldata, value } = SwapRouter.swapCallParameters(routerTrade);

        const impersonatedSigner = await ethers.getImpersonatedSigner(wallet);
        const res = await impersonatedSigner.sendTransaction({
            data: calldata,
            to: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
            value: amount
        });
        const tx = await res.wait();

        console.log(res, tx);
    }
};

main(
    '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    'buy',
    '1000000000000000000',
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
