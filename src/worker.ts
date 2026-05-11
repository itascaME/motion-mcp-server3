import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MotionApiService } from "./services/motionApi";
import { WorkspaceResolver } from "./utils/workspaceResolver";
import { InputValidator } from "./utils/validator";
import { HandlerFactory } from "./handlers/HandlerFactory";
import { ToolRegistry, ToolConfigurator } from "./tools";
import { jsonSchemaToZodShape } from "./utils/jsonSchemaToZod";
import { SERVER_INSTRUCTIONS } from "./utils/serverInstructions";

interface Env {
  MOTION_API_KEY: string;
  MOTION_MCP_SECRET: string;
  MOTION_MCP_TOOLS?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

export class MotionMCPAgent extends McpAgent<Env> {
  server = new McpServer(
    { name: "motion-mcp-server", version: "2.8.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init() {
    const motionService = new MotionApiService(this.env.MOTION_API_KEY);
    const workspaceResolver = new WorkspaceResolver(motionService);
    const validator = new InputValidator();
    const context = { motionService, workspaceResolver, validator };
    const handlerFactory = new HandlerFactory(context);

    const registry = new ToolRegistry();
    const configurator = new ToolConfigurator(
      this.env.MOTION_MCP_TOOLS || "complete",
      registry
    );
    const enabledTools = configurator.getEnabledTools();
    validator.initializeValidators(enabledTools);

    for (const tool of enabledTools) {
      const zodShape = jsonSchemaToZodShape(tool.inputSchema as Parameters<typeof jsonSchemaToZodShape>[0]);

      this.server.tool(
        tool.name,
        tool.description,
        zodShape,
        async (params) => {
          const handler = handlerFactory.createHandler(tool.name);
          return await handler.handle(params);
        }
      );
    }
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", server: "motion-mcp-server" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // OAuth server metadata endpoint (for Claude and other MCP clients)
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(
        JSON.stringify({
          issuer: new URL(url.origin).origin,
          authorization_endpoint: `${url.origin}/oauth/authorize`,
          token_endpoint: `${url.origin}/oauth/token`,
          registration_endpoint: `${url.origin}/register`,
          scopes_supported: ["motion"],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // OAuth registration endpoint for client registration
    if (url.pathname === "/register" && request.method === "POST") {
      return handleOAuthRegistration(request);
    }

    // Validate secret path: /mcp/{secret}/...
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts[0] !== "mcp" || pathParts[1] !== env.MOTION_MCP_SECRET) {
      return new Response("Not found", { status: 404 });
    }
    
    // Rewrite path to strip the secret before passing to McpAgent
    const cleanPath = "/mcp" + (pathParts.length > 2 ? "/" + pathParts.slice(2).join("/") : "");
    const cleanUrl = new URL(cleanPath, url.origin);
    const cleanRequest = new Request(cleanUrl, request);
    return MotionMCPAgent.serve("/mcp").fetch(cleanRequest, env, ctx);
  },
};

/**
 * Handle OAuth client registration endpoint
 * Stub implementation for Claude connector OAuth registration
 */
async function handleOAuthRegistration(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;

    // Generate a client ID (stub implementation)
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const clientSecret = `secret_${Math.random().toString(36).substr(2, 20)}`;

    // Return the registration response
    return new Response(
      JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        client_name: body.client_name || "Motion MCP Client",
        redirect_uris: body.redirect_uris || [],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      }),
      { 
        status: 201,
        headers: { "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "Invalid registration request" }),
      { 
        status: 400,
        headers: { "Content-Type": "application/json" } 
      }
    );
  }
}
