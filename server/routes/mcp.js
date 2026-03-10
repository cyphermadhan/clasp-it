/**
 * MCP endpoint — GET + POST /mcp
 *
 * Uses @modelcontextprotocol/sdk with StreamableHTTPServerTransport (stateless mode).
 * A new transport + server pair is created per-request so there is no shared state
 * between callers. This is the recommended approach for stateless HTTP deployments.
 *
 * Tools exposed:
 *   get_element_context        — latest pick for the caller
 *   get_element_context_by_id  — specific pick by id
 *   list_recent_picks          — last 10 picks
 *   clear_context              — delete all picks
 */

import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getLatestPick,
  getPickById,
  listRecentPicks,
  clearPicks,
  updatePickStatus,
} from '../lib/storage.js';
import { requireApiKey } from '../lib/auth.js';

const router = Router();

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_element_context',
    description: 'Returns the most recently picked DOM element context for the current user.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_element_context_by_id',
    description: 'Returns a specific pick by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The pick ID returned when the element was captured.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_recent_picks',
    description:
      'Returns recent element picks for the current user, newest first. ' +
      'Use this when the user wants to fix multiple elements at once, or asks about "all picks", "recent picks", or "everything I sent". ' +
      'Each pick includes the element context, selector, page URL, and user prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of picks to return (1–20). Defaults to 10.',
        },
      },
      required: [],
    },
  },
  {
    name: 'clear_context',
    description: 'Clears all stored element picks for the current user.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_pick_status',
    description:
      'Update the status of a pick. Call with status="in_progress" when you start working on it, ' +
      'and status="completed" when you\'re done. The extension sidebar shows these statuses to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The pick ID.' },
        status: {
          type: 'string',
          enum: ['not_started', 'in_progress', 'completed'],
          description: 'New status for the pick.',
        },
      },
      required: ['id', 'status'],
    },
  },
];

// ─── Factory: create a wired-up MCP Server + Transport per request ────────────

function createMcpServer(userId) {
  const server = new Server(
    { name: 'clasp-it', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // List tools
  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({ tools: TOOLS }),
  );

  // Call tool
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args = {} } = request.params;

      switch (name) {
        case 'get_element_context': {
          const pick = await getLatestPick(userId);
          if (pick) {
            // Auto-mark as in_progress when Claude reads it
            updatePickStatus(userId, pick.id, 'in_progress').catch(() => {});
          }
          return {
            content: [
              {
                type: 'text',
                text: pick
                  ? JSON.stringify(pick, null, 2)
                  : 'No element context found. Use the browser extension to pick an element first.',
              },
            ],
          };
        }

        case 'get_element_context_by_id': {
          const { id } = args;
          if (!id) {
            return {
              content: [{ type: 'text', text: 'Error: id parameter is required.' }],
              isError: true,
            };
          }
          const pick = await getPickById(userId, id);
          if (pick) {
            updatePickStatus(userId, pick.id, 'in_progress').catch(() => {});
          }
          return {
            content: [
              {
                type: 'text',
                text: pick
                  ? JSON.stringify(pick, null, 2)
                  : `No pick found with id: ${id}`,
              },
            ],
          };
        }

        case 'list_recent_picks': {
          const limit = Math.min(Math.max(parseInt(args.limit ?? 10, 10), 1), 20);
          const picks = await listRecentPicks(userId, limit);
          return {
            content: [
              {
                type: 'text',
                text:
                  picks.length > 0
                    ? `Found ${picks.length} pick(s):\n\n${JSON.stringify(picks, null, 2)}`
                    : 'No picks found. Use the browser extension to pick some elements first.',
              },
            ],
          };
        }

        case 'clear_context': {
          await clearPicks(userId);
          return {
            content: [{ type: 'text', text: 'All picks cleared successfully.' }],
          };
        }

        case 'update_pick_status': {
          const { id, status } = args;
          if (!id || !status) {
            return {
              content: [{ type: 'text', text: 'Error: id and status are required.' }],
              isError: true,
            };
          }
          const validStatuses = ['not_started', 'in_progress', 'completed'];
          if (!validStatuses.includes(status)) {
            return {
              content: [{ type: 'text', text: `Error: status must be one of ${validStatuses.join(', ')}.` }],
              isError: true,
            };
          }
          const updated = await updatePickStatus(userId, id, status);
          return {
            content: [{
              type: 'text',
              text: updated
                ? `Pick ${id} status updated to "${status}".`
                : `Pick ${id} not found.`,
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    },
  );

  // Stateless transport — no sessionIdGenerator means no session management.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  return { server, transport };
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handleMcp(req, res) {
  const userId = req.userId; // set by requireApiKey middleware

  const { server, transport } = createMcpServer(userId);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    // Clean up after the response is fully sent so we don't cut streams early.
    res.on('finish', async () => {
      try {
        await server.close();
      } catch {
        // ignore cleanup errors
      }
    });
  }
}

// StreamableHTTPServerTransport handles both GET (SSE listen) and POST (JSON-RPC)
router.get('/', requireApiKey, handleMcp);
router.post('/', requireApiKey, handleMcp);

// Optional: handle DELETE for explicit session termination (stateless — nothing to do)
router.delete('/', (_req, res) => {
  res.status(200).json({ success: true });
});

export default router;
