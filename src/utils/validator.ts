/**
 * Input Validation Service - Runtime validation for MCP requests
 * 
 * This module provides runtime validation of incoming MCP requests
 * against their defined schemas using Zod, ensuring type safety
 * at runtime and preventing malformed inputs from causing errors.
 * 
 * Zod is Cloudflare Workers compatible, unlike AJV which uses eval().
 */

import { z, fromJSONSchema } from 'zod';
import { McpToolDefinition } from '../types/mcp';

export class InputValidator {
  private validators: Map<string, z.ZodSchema>;

  constructor() {
    this.validators = new Map();
  }

  /**
   * Compile and cache validators for all tool definitions
   */
  initializeValidators(toolDefinitions: McpToolDefinition[]): void {
    for (const tool of toolDefinitions) {
      try {
        const zodSchema = fromJSONSchema(tool.inputSchema);
        this.validators.set(tool.name, zodSchema);
      } catch (error) {
        console.error(`Failed to compile schema for tool ${tool.name}:`, error);
        // Set a fallback validator that accepts any object
        this.validators.set(tool.name, z.any());
      }
    }
  }

  /**
   * Validate input arguments against tool schema
   */
  validateInput(toolName: string, args: unknown): { valid: boolean; errors?: string } {
    const validator = this.validators.get(toolName);
    
    if (!validator) {
      return { 
        valid: false, 
        errors: `No validator found for tool: ${toolName}` 
      };
    }

    try {
      validator.parse(args);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
        };
      }
      return {
        valid: false,
        errors: `Validation error: ${String(error)}`
      };
    }
  }

  /**
   * Get detailed validation errors for debugging
   */
  getDetailedErrors(toolName: string): any[] | undefined {
    const validator = this.validators.get(toolName);
    if (!validator) return undefined;
    
    // Try to get errors from the validator if available
    // For Zod, we'd need to run parse in a try-catch to get errors
    return undefined;
  }

  /**
   * Clear all cached validators
   */
  clearValidators(): void {
    this.validators.clear();
  }

  /**
   * Check if a validator exists for a tool
   */
  hasValidator(toolName: string): boolean {
    return this.validators.has(toolName);
  }
}