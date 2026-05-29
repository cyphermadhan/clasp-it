/**
 * WebMCP — expose Clasp-it tools to AI agents via the browser.
 * https://webmachinelearning.github.io/webmcp/
 *
 * Only runs if the browser supports the API (navigator.modelContext).
 * No-op otherwise — no polyfills, no errors.
 */

if (typeof navigator !== 'undefined' && navigator.modelContext) {
  navigator.modelContext.registerTool({
    name: 'get_element_context',
    description: 'Get the most recently picked webpage element context including HTML, CSS, selector, and optional screenshot',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return { message: 'Install the Clasp-it Chrome extension and configure MCP at https://claspit.dev/mcp with your API key to use this tool.' };
    },
  });

  navigator.modelContext.registerTool({
    name: 'list_recent_picks',
    description: 'List recent element picks from the Clasp-it Chrome extension',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max picks to return (1-20, default 10)' },
      },
    },
    async execute() {
      return { message: 'Install the Clasp-it Chrome extension and configure MCP at https://claspit.dev/mcp with your API key to use this tool.' };
    },
  });

  navigator.modelContext.registerTool({
    name: 'setup_clasp_it',
    description: 'Get setup instructions for Clasp-it MCP integration with Claude Code',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return {
        setup: {
          step1: 'Install the Clasp-it extension from Chrome Web Store',
          step2: 'Sign up at https://claspit.dev to get a free API key',
          step3: 'Run: claude mcp add --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"',
          step4: 'Pick any element on a webpage and Claude Code receives its full context',
        },
      };
    },
  });
}
