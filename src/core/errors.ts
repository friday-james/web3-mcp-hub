export class DefiMcpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DefiMcpError";
  }
}

export class ChainNotSupportedError extends DefiMcpError {
  constructor(chainId: string) {
    super(
      `Chain "${chainId}" is not supported`,
      "CHAIN_NOT_SUPPORTED",
      { chainId }
    );
  }
}

export class TokenNotFoundError extends DefiMcpError {
  constructor(token: string, chainId: string) {
    super(
      `Token "${token}" not found on chain "${chainId}"`,
      "TOKEN_NOT_FOUND",
      { token, chainId }
    );
  }
}

export class AggregatorError extends DefiMcpError {
  constructor(aggregator: string, message: string) {
    super(
      `${aggregator}: ${message}`,
      "AGGREGATOR_ERROR",
      { aggregator }
    );
  }
}

export class InvalidAddressError extends DefiMcpError {
  constructor(address: string, chainId: string) {
    super(
      `Invalid address "${address}" for chain "${chainId}"`,
      "INVALID_ADDRESS",
      { address, chainId }
    );
  }
}
