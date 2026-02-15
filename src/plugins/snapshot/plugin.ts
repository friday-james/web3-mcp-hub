import { z } from "zod";
import type {
  DefiPlugin,
  PluginContext,
  ToolDefinition,
  ToolResult,
} from "../../core/types.js";

const SNAPSHOT_GQL = "https://hub.snapshot.org/graphql";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function gqlQuery(query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(SNAPSHOT_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Snapshot API ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

export class SnapshotPlugin implements DefiPlugin {
  readonly name = "snapshot";
  readonly description = "Snapshot governance: spaces, proposals, and voting power";
  readonly version = "1.0.0";

  async initialize(_ctx: PluginContext): Promise<void> {}

  getTools(): ToolDefinition[] {
    return [this.spacesTool(), this.proposalsTool(), this.votePowerTool()];
  }

  private spacesTool(): ToolDefinition {
    return {
      name: "defi_snapshot_spaces",
      description:
        "List governance spaces on Snapshot. Search by name or list top spaces by followers.",
      inputSchema: z.object({
        search: z.string().optional().describe("Search query (e.g. protocol name)"),
        limit: z.number().int().min(1).max(50).optional().describe("Number of results (default 20)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { search, limit = 20 } = input as { search?: string; limit?: number };

          const query = `
            query Spaces($first: Int!, $search: String) {
              spaces(
                first: $first,
                skip: 0,
                orderBy: "followersCount",
                orderDirection: desc,
                where: { name_contains: $search }
              ) {
                id
                name
                network
                symbol
                followersCount
                proposalsCount
                about
                categories
              }
            }
          `;

          const data = await gqlQuery(query, { first: limit, search: search || "" });

          return jsonResult({
            count: data.spaces.length,
            spaces: data.spaces,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch spaces: ${e.message}`);
        }
      },
    };
  }

  private proposalsTool(): ToolDefinition {
    return {
      name: "defi_snapshot_proposals",
      description:
        "List governance proposals for a Snapshot space. Shows title, status, votes, and results.",
      inputSchema: z.object({
        space: z.string().describe('Space ID (e.g. "aave.eth", "uniswapgovernance.eth")'),
        state: z
          .enum(["active", "closed", "pending", "all"])
          .optional()
          .describe('Filter by state (default "active")'),
        limit: z.number().int().min(1).max(30).optional().describe("Number of results (default 10)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { space, state = "active", limit = 10 } = input as {
            space: string; state?: string; limit?: number;
          };

          const where: any = { space };
          if (state !== "all") where.state = state;

          const query = `
            query Proposals($first: Int!, $where: ProposalWhere) {
              proposals(
                first: $first,
                skip: 0,
                orderBy: "created",
                orderDirection: desc,
                where: $where
              ) {
                id
                title
                state
                type
                author
                created
                start
                end
                choices
                scores
                scores_total
                votes
                quorum
                body
              }
            }
          `;

          const data = await gqlQuery(query, { first: limit, where });

          const proposals = data.proposals.map((p: any) => ({
            id: p.id,
            title: p.title,
            state: p.state,
            type: p.type,
            author: p.author,
            created: new Date(p.created * 1000).toISOString(),
            start: new Date(p.start * 1000).toISOString(),
            end: new Date(p.end * 1000).toISOString(),
            votes: p.votes,
            quorum: p.quorum,
            results: p.choices?.map((c: string, i: number) => ({
              choice: c,
              score: p.scores?.[i] || 0,
              percentage: p.scores_total > 0
                ? `${((p.scores?.[i] || 0) / p.scores_total * 100).toFixed(1)}%`
                : "0%",
            })),
            summary: p.body?.slice(0, 200),
          }));

          return jsonResult({ space, state, count: proposals.length, proposals });
        } catch (e: any) {
          return errorResult(`Failed to fetch proposals: ${e.message}`);
        }
      },
    };
  }

  private votePowerTool(): ToolDefinition {
    return {
      name: "defi_snapshot_vote_power",
      description:
        "Get the voting power of an address in a Snapshot space for a specific proposal.",
      inputSchema: z.object({
        space: z.string().describe("Space ID"),
        voter: z.string().describe("Voter wallet address"),
        proposal: z.string().optional().describe("Proposal ID (if checking for a specific proposal)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        try {
          const { space, voter, proposal } = input as {
            space: string; voter: string; proposal?: string;
          };

          const query = `
            query Votes($where: VoteWhere) {
              votes(
                first: 10,
                orderBy: "created",
                orderDirection: desc,
                where: $where
              ) {
                id
                voter
                vp
                choice
                created
                proposal {
                  id
                  title
                  choices
                }
              }
            }
          `;

          const where: any = { space, voter: voter.toLowerCase() };
          if (proposal) where.proposal = proposal;

          const data = await gqlQuery(query, { where });

          const votes = data.votes.map((v: any) => ({
            proposal: v.proposal?.title,
            proposalId: v.proposal?.id,
            votingPower: v.vp,
            choice: Array.isArray(v.choice)
              ? v.choice.map((c: number) => v.proposal?.choices?.[c - 1])
              : v.proposal?.choices?.[v.choice - 1],
            date: new Date(v.created * 1000).toISOString(),
          }));

          return jsonResult({
            space,
            voter,
            recentVotes: votes,
            totalVotingPower: votes[0]?.votingPower || 0,
          });
        } catch (e: any) {
          return errorResult(`Failed to fetch voting power: ${e.message}`);
        }
      },
    };
  }
}
