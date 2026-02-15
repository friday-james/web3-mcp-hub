import type {
  ChainAdapter,
  ChainEcosystem,
  ChainInfo,
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  AppConfig,
} from "./types.js";
import type { ProtocolScanner } from "./scanner-types.js";
import type { YieldSource } from "./yield-types.js";
import { ChainNotSupportedError } from "./errors.js";

export class Registry {
  private chainAdapters = new Map<ChainEcosystem, ChainAdapter>();
  private plugins = new Map<string, DefiPlugin>();
  private chainIndex = new Map<string, ChainEcosystem>();
  private scanners: ProtocolScanner[] = [];
  private yieldSources: YieldSource[] = [];
  private pluginContext: PluginContext;

  constructor(private config: AppConfig) {
    this.pluginContext = {
      getChainAdapter: (eco) => this.getChainAdapter(eco),
      getChainAdapterForChain: (chainId) => this.getChainAdapterForChain(chainId),
      getAllChains: () => this.getSupportedChains(),
      config: this.config,
      getScanners: () => this.scanners,
      getYieldSources: () => this.yieldSources,
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

  // ---- Scanners & Yield Sources ----

  registerScanner(scanner: ProtocolScanner): void {
    this.scanners.push(scanner);
  }

  registerYieldSource(source: YieldSource): void {
    this.yieldSources.push(source);
  }

  // ---- Plugins ----

  async registerPlugin(plugin: DefiPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Validate tool names before registering
    const existingToolNames = new Set<string>();
    for (const p of this.plugins.values()) {
      for (const tool of p.getTools()) {
        existingToolNames.add(tool.name);
      }
    }

    await plugin.initialize(this.pluginContext);

    for (const tool of plugin.getTools()) {
      if (existingToolNames.has(tool.name)) {
        throw new Error(
          `Tool name "${tool.name}" from plugin "${plugin.name}" conflicts with an existing tool`
        );
      }
      if (!tool.name.startsWith("defi_")) {
        throw new Error(
          `Tool name "${tool.name}" must start with "defi_" prefix`
        );
      }
    }

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
