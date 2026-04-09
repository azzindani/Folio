import { describe, it, expect } from 'vitest';
import {
  resolveComponent,
  resolveTemplate,
  validateComponentSlots,
  validateTemplateSlots,
} from './component-resolver';
import type { ComponentSpec, TemplateSpec } from '../schema/types';

const testComponent: ComponentSpec = {
  _protocol: 'component/v1',
  name: 'step-badge',
  version: '1.0.0',
  description: 'A numbered step badge',
  props: {
    number: { type: 'string', default: '01' },
    label: { type: 'string', default: 'Step' },
    accent: { type: 'color', default: '#E94560' },
  },
  layers: [
    {
      id: 'badge-bg',
      type: 'rect',
      z: 0,
      x: 0, y: 0, width: 60, height: 60,
      fill: { type: 'solid', color: '{{accent}}' },
      radius: 30,
    },
    {
      id: 'badge-num',
      type: 'text',
      z: 1,
      x: 0, y: 0, width: 60, height: 60,
      content: { type: 'plain', value: '{{number}}' },
      style: { font_size: 24, font_weight: 700, color: '#FFFFFF', align: 'center' },
    },
  ],
};

const testTemplate: TemplateSpec = {
  _protocol: 'template/v1',
  name: 'step-page',
  version: '1.0.0',
  description: 'A step page template',
  slots: {
    step_number: { type: 'string', required: true },
    step_title: { type: 'string', required: true },
    step_body: { type: 'string', default: '' },
    accent: { type: 'color', default: '#E94560' },
  },
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  layers: [
    {
      id: 'bg',
      type: 'rect',
      z: 0,
      x: 0, y: 0, width: 1080, height: 1080,
      fill: { type: 'solid', color: '{{accent}}' },
    },
    {
      id: 'title',
      type: 'text',
      z: 20,
      x: 80, y: 200, width: 920,
      content: { type: 'plain', value: '{{step_title}}' },
      style: { font_size: 48, font_weight: 700, color: '#FFFFFF' },
    },
  ],
};

describe('resolveComponent', () => {
  it('resolves slots into component layers', () => {
    const layers = resolveComponent(testComponent, { number: '03', accent: '#00FF00' });
    expect(layers).toHaveLength(2);

    const bgLayer = layers[0] as unknown as Record<string, unknown>;
    const fill = bgLayer['fill'] as { color: string };
    expect(fill.color).toBe('#00FF00');
  });

  it('uses default values for missing slots', () => {
    const layers = resolveComponent(testComponent, {});
    const textLayer = layers[1] as unknown as Record<string, unknown>;
    const content = textLayer['content'] as { value: string };
    expect(content.value).toBe('01'); // default
  });

  it('applies overrides', () => {
    const layers = resolveComponent(testComponent, { number: '05' }, { accent: '#0000FF' });
    const bgLayer = layers[0] as unknown as Record<string, unknown>;
    const fill = bgLayer['fill'] as { color: string };
    expect(fill.color).toBe('#0000FF');
  });
});

describe('resolveTemplate', () => {
  it('creates a page from template slots', () => {
    const page = resolveTemplate(testTemplate, {
      step_number: '01',
      step_title: 'Install Node.js',
    });

    expect(page.id).toBeTruthy();
    expect(page.layers).toHaveLength(2);
  });

  it('resolves slot values in content', () => {
    const page = resolveTemplate(testTemplate, {
      step_number: '01',
      step_title: 'Install Node.js',
      accent: '#FF0000',
    });

    const titleLayer = page.layers![1] as unknown as Record<string, unknown>;
    const content = titleLayer['content'] as { value: string };
    expect(content.value).toBe('Install Node.js');
  });

  it('uses defaults for missing optional slots', () => {
    const page = resolveTemplate(testTemplate, {
      step_number: '01',
      step_title: 'Hello',
    });

    const bgLayer = page.layers![0] as unknown as Record<string, unknown>;
    const fill = bgLayer['fill'] as { color: string };
    expect(fill.color).toBe('#E94560'); // default accent
  });
});

describe('validateComponentSlots', () => {
  it('returns no errors when all props provided', () => {
    const errors = validateComponentSlots(testComponent, {
      number: '01', label: 'Step', accent: '#FF0000',
    });
    expect(errors).toHaveLength(0);
  });

  it('returns no errors when defaults cover missing props', () => {
    const errors = validateComponentSlots(testComponent, {});
    expect(errors).toHaveLength(0); // all have defaults
  });

  it('detects missing props without defaults', () => {
    const comp: ComponentSpec = {
      ...testComponent,
      props: {
        ...testComponent.props,
        required_field: { type: 'string' }, // no default
      },
    };
    const errors = validateComponentSlots(comp, {});
    expect(errors.some(e => e.includes('required_field'))).toBe(true);
  });
});

describe('validateTemplateSlots', () => {
  it('detects missing required slots', () => {
    const errors = validateTemplateSlots(testTemplate, {});
    expect(errors.some(e => e.includes('step_number'))).toBe(true);
    expect(errors.some(e => e.includes('step_title'))).toBe(true);
  });

  it('returns no errors when required slots provided', () => {
    const errors = validateTemplateSlots(testTemplate, {
      step_number: '01',
      step_title: 'Test',
    });
    expect(errors).toHaveLength(0);
  });
});
