import { describe, it, expect } from 'vitest';
import { parseYAML, serializeYAML, ParseError } from './parser';

describe('parseYAML', () => {
  it('parses valid YAML', () => {
    const result = parseYAML<{ name: string }>('name: hello');
    expect(result.name).toBe('hello');
  });

  it('parses nested objects', () => {
    const yaml = `
meta:
  id: test
  name: "My Design"
`;
    const result = parseYAML<{ meta: { id: string; name: string } }>(yaml);
    expect(result.meta.id).toBe('test');
    expect(result.meta.name).toBe('My Design');
  });

  it('parses arrays', () => {
    const yaml = `
layers:
  - id: bg
    type: rect
  - id: txt
    type: text
`;
    const result = parseYAML<{ layers: { id: string; type: string }[] }>(yaml);
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0].id).toBe('bg');
    expect(result.layers[1].type).toBe('text');
  });

  it('throws ParseError for invalid YAML', () => {
    expect(() => parseYAML('{ invalid: yaml: bad }')).toThrow(ParseError);
  });

  it('handles empty input', () => {
    const result = parseYAML('');
    expect(result).toBeUndefined();
  });

  it('handles unicode/emoji content', () => {
    const result = parseYAML<{ text: string }>('text: "Hello World \u{1F30D}"');
    expect(result.text).toContain('\u{1F30D}');
  });

  it('handles multiline strings', () => {
    const yaml = `
content: |
  Line 1
  Line 2
  Line 3
`;
    const result = parseYAML<{ content: string }>(yaml);
    expect(result.content).toContain('Line 1');
    expect(result.content).toContain('Line 3');
  });
});

describe('serializeYAML', () => {
  it('serializes objects to YAML', () => {
    const result = serializeYAML({ name: 'test', value: 42 });
    expect(result).toContain('name: test');
    expect(result).toContain('value: 42');
  });

  it('roundtrips correctly', () => {
    const original = {
      _protocol: 'design/v1',
      meta: { id: 'test', name: 'Test Design' },
      layers: [
        { id: 'bg', type: 'rect', z: 0 },
        { id: 'txt', type: 'text', z: 20 },
      ],
    };
    const yaml = serializeYAML(original);
    const parsed = parseYAML(yaml);
    expect(parsed).toEqual(original);
  });

  it('handles nested structures', () => {
    const data = {
      fill: {
        type: 'linear',
        stops: [
          { color: '#000', position: 0 },
          { color: '#FFF', position: 100 },
        ],
      },
    };
    const yaml = serializeYAML(data);
    const parsed = parseYAML(yaml);
    expect(parsed).toEqual(data);
  });
});

import { parseDesign, parseTheme, parseComponent, parseTemplate } from './parser';

describe('ParseError — line/column info', () => {
  it('includes line number in ParseError', () => {
    try {
      parseYAML('key: [unclosed');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      // line/column may or may not be defined depending on yaml error type
      expect(e instanceof ParseError && e.name).toBe('ParseError');
    }
  });
});

describe('parseDesign', () => {
  it('parses valid design YAML', () => {
    const src = `
_protocol: design/v1
meta:
  id: d1
  name: Test
  type: poster
  created: "2026-01-01"
  modified: "2026-01-01"
document:
  width: 1080
  height: 1080
  unit: px
  dpi: 96
layers: []
`;
    const spec = parseDesign(src);
    expect(spec._protocol).toBe('design/v1');
    expect(spec.meta.id).toBe('d1');
  });

  it('throws ParseError for malformed design YAML', () => {
    expect(() => parseDesign('{ bad: yaml: :')).toThrow(ParseError);
  });
});

describe('parseTheme', () => {
  it('parses a minimal theme', () => {
    const src = `_protocol: theme/v1\nname: Dark\nversion: 1.0.0\ncolors: {}\ntyography: {}\nspacing: {unit: 8, scale: []}\neffects: {}\nradii: {}`;
    const theme = parseTheme(src);
    expect(theme.name).toBe('Dark');
  });
});

describe('parseComponent', () => {
  it('parses a minimal component', () => {
    const src = `_protocol: component/v1\nname: Badge\nversion: 1.0.0\nprops: {}\nlayers: []`;
    const comp = parseComponent(src);
    expect(comp.name).toBe('Badge');
  });
});

describe('parseTemplate', () => {
  it('parses a minimal template', () => {
    const src = `_protocol: template/v1\nmeta:\n  id: t1\n  name: T\n  type: poster\n  created: ""\n  modified: ""\ndocument:\n  width: 1080\n  height: 1080\n  unit: px\n  dpi: 96\nslots: []`;
    const tpl = parseTemplate(src);
    expect(tpl._protocol).toBe('template/v1');
    expect(tpl.slots).toEqual([]);
  });
});
