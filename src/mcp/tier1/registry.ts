// §7 Tier 1 — Basic (6 tools): project management & navigation
import type { ToolDefinition } from '../types';

export const TIER1_TOOLS: ToolDefinition[] = [
  {
    name: 'create_project',
    description: 'Create a new design project with directory structure, default theme, and project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Project name' },
        path:   { type: 'string', description: 'Absolute directory path to create project in' },
        theme:  { type: 'string', description: 'Theme ID (default: dark-tech)', default: 'dark-tech' },
        canvas: { type: 'string', description: 'Canvas size e.g. "1080x1080"', default: '1080x1080' },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'list_designs',
    description: 'List designs in a project. Returns max 40 items with truncated/total fields.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
    },
  },
  {
    name: 'list_themes',
    description: 'List available themes registered in project.yaml.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string', description: 'Path to project directory' } },
      required: ['project_path'],
    },
  },
  {
    name: 'apply_theme',
    description: 'Set active theme for a project. Updates project.yaml default_theme.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Path to project directory' },
        theme_id:     { type: 'string', description: 'Theme ID to activate' },
      },
      required: ['project_path', 'theme_id'],
    },
  },
  {
    name: 'duplicate_design',
    description: 'Copy an existing design with a new name and UUID. Registers copy in project.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        design_path:  { type: 'string', description: 'Path to source .design.yaml file' },
        new_name:     { type: 'string', description: 'Name for the duplicated design' },
        project_path: { type: 'string', description: 'Path to project directory (for registry update)' },
      },
      required: ['design_path', 'new_name'],
    },
  },
  {
    name: 'resume_design',
    description: 'Read generation state of an in-progress carousel so the LLM can continue appending pages.',
    inputSchema: {
      type: 'object',
      properties: { design_path: { type: 'string', description: 'Path to .design.yaml file' } },
      required: ['design_path'],
    },
  },
];
