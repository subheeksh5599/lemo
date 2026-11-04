/**
 * The contract state the flow page reasons about, read as it is needed.
 *
 * Each reader returns what the chain said, plus the code size at the address so
 * "configured but nothing deployed there" is a state the page can name instead
 * of an empty panel.
 */

import {
  feedFunction,
  gateFunction,
  readAddress,
  readBool,
  readBytes32,
  readCodeSize,
  readString,
  readUint,
  verifierFunction,
} from './evm'

export type GateState = {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  titleId: string
  titleCommitment: string
  acceptedRevision: bigint
  boundChainId: bigint
  paused: boolean
  verifier: string
  feed: string
  owner: string
  outstanding: boolean
}

export type Probe<T> = {
  address: string
  codeSize: number
  state: T | null
  problem: string | null
}

export async function readGateState(address: string): Promise<Probe<GateState>> {
  const codeSize = await readCodeSize(address)
  if (codeSize === 0) {
    return { address, codeSize, state: null, problem: 'no contract code at this address' }
  }

  try {
    const [
      name,
      symbol,
      decimals,
      totalSupply,
      titleId,
      titleCommitment,
      acceptedRevision,
      boundChainId,
      paused,
      verifier,
      feed,
      owner,
      outstanding,
    ] = await Promise.all([
      readString(address, gateFunction('name')),
      readString(address, gateFunction('symbol')),
      readUint(address, gateFunction('decimals')),
      readUint(address, gateFunction('totalSupply')),
      readBytes32(address, gateFunction('titleId')),
      readBytes32(address, gateFunction('titleCommitment')),
      readUint(address, gateFunction('acceptedRevision')),
      readUint(address, gateFunction('boundChainId')),
      readBool(address, gateFunction('paused')),
      readAddress(address, gateFunction('verifier')),
      readAddress(address, gateFunction('feed')),
      readAddress(address, gateFunction('owner')),
      readBool(address, gateFunction('representationOutstanding')),
    ])

    return {
      address,
      codeSize,
      problem: null,
      state: {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply,
        titleId,
        titleCommitment,
        acceptedRevision,
        boundChainId,
        paused,
        verifier,
        feed,
        owner,
        outstanding,
      },
    }
  } catch (cause) {
    return {
      address,
      codeSize,
      state: null,
      problem: cause instanceof Error ? cause.message : 'the gate did not answer',
    }
  }
}

export type VerifierState = {
  operationMint: number
  operationTransfer: number
  operationBurn: number
  hasher: string | null
}

export async function readVerifierState(address: string): Promise<Probe<VerifierState>> {
  const codeSize = await readCodeSize(address)
  if (codeSize === 0) {
    return { address, codeSize, state: null, problem: 'no contract code at this address' }
  }

  try {
    const [operationMint, operationTransfer, operationBurn] = await Promise.all([
      readUint(address, verifierFunction('OP_MINT')),
      readUint(address, verifierFunction('OP_TRANSFER')),
      readUint(address, verifierFunction('OP_BURN')),
    ])

    let hasher: string | null = null
    try {
      hasher = await readAddress(address, verifierFunction('hasher'))
    } catch {
      // The hasher getter is not part of the gate's trust path; absence is fine.
    }

    return {
      address,
      codeSize,
      problem: null,
      state: {
        operationMint: Number(operationMint),
        operationTransfer: Number(operationTransfer),
        operationBurn: Number(operationBurn),
        hasher,
      },
    }
  } catch (cause) {
    return {
      address,
      codeSize,
      state: null,
      problem: cause instanceof Error ? cause.message : 'the verifier did not answer',
    }
  }
}

export type FeedState = {
  root: string
  blockNumber: bigint
  pinned: boolean
  live: boolean | null
  attester: string | null
}

export async function readFeedState(address: string): Promise<Probe<FeedState>> {
  const codeSize = await readCodeSize(address)
  if (codeSize === 0) {
    return { address, codeSize, state: null, problem: 'no contract code at this address' }
  }

  try {
    const [root, blockNumber] = await Promise.all([
      readAddress(address, feedFunction('currentRoot')),
      readUint(address, feedFunction('currentBlockNumber')),
    ])

    // BeefyRootFeed has no `pinned()`: it never pins, so absence reads as false.
    let pinned = false
    try {
      pinned = await readBool(address, feedFunction('pinned'))
    } catch {
      pinned = false
    }

    // A threshold feed has no `live()` or `attester()`; both are optional reads.
    let live: boolean | null = null
    try {
      live = await readBool(address, feedFunction('live'))
    } catch {
      live = null
    }

    let attester: string | null = null
    try {
      attester = await readAddress(address, feedFunction('attester'))
    } catch {
      attester = null
    }

    return {
      address,
      codeSize,
      problem: null,
      state: { root, blockNumber, pinned, live, attester },
    }
  } catch (cause) {
    return {
      address,
      codeSize,
      state: null,
      problem: cause instanceof Error ? cause.message : 'the feed did not answer',
    }
  }
}
