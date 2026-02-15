import type {
  ChainAdapter,
  ChainEcosystem,
  ChainInfo,
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  AppConfig,
} from "./types.js";
import { ChainNotSupportedError } from "./errors.js";

export class Registry {
  private chainAdapters = new Map<ChainEcosystem, ChainAdapter>();
  private plugins = new Map<string, DefiPlugin>();
  private chainIndex = new Map<string, ChainEcosystem>();
  private pluginContext: PluginContext;

  constructor(private config: AppConfig) {
    this.pluginContext = {
      getChainAdapter: (eco) => this.getChainAdapter(eco),
      getChainAdapterForChain: (chainId) => this.getChainAdapterForChain(chainId),
      getAllChains: () => this.getSupportedChains(),
      config: this.config,
    };
  }

  // ---- Chain Adapters ----

  registerChainAdapter(adapter: ChainAdapter): void {
    this.chainAdapters.set(adapter.ecosystem, adapter);
    for (const chain of adapter.getSupportedChains()) {
      this.chainIndex.set(chain.id, adapter.ecosystem);
    }
  }

  getChainAdapter(ecosystem: ChainEcosystem): ChainAdapter {
    const adapter = this.chainAdapters.get(ecosystem);
    if (!adapter) throw new ChainNotSupportedError(ecosystem);
    return adapter;
  }

  getChainAdapterForChain(chainId: string): ChainAdapter {
    const ecosystem = this.chainIndex.get(chainId);
    if (!ecosystem) throw new ChainNotSupportedError(chainId);
    return this.getChainAdapter(ecosystem);
  }

  getSupportedChains(): ChainInfo[] {
    const chains: ChainInfo[] = [];
    for (const adapter of this.chainAdapters.values()) {
      chains.push(...adapter.getSupportedChains());
    }
    return chains;
  }

  // ---- Plugins ----

  async registerPlugin(plugin: DefiPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    await plugin.initialize(this.pluginContext);
    this.plugins.set(plugin.name, plugin);
  }

  getAllTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.getTools());
    }
    return tools;
  }

  getPluginContext(): PluginContext {
    return this.pluginContext;
  }

  async shutdown(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.shutdown?.();
    }
  }
}
