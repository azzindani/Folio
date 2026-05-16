// Curated template × theme combinations surfaced under the Featured tab.
// Hand-picked rather than auto-generated so each combo actually looks good.

export interface FeaturedCombo {
  id: string;
  name: string;
  templateId: string;
  themeId: string;
  description?: string;
}

export const FEATURED_COMBOS: FeaturedCombo[] = [
  {
    id: 'stats-board',
    name: 'Quarterly Stats — Board Update',
    templateId: 'tmpl-stats-card',
    themeId: 'indigo-pro',
    description: 'Single KPI tile in deep indigo for a clean board deck.',
  },
  {
    id: 'event-neon',
    name: 'Festival Poster — Neon Bloom',
    templateId: 'tmpl-event-poster',
    themeId: 'neon-bloom',
    description: 'Portrait event poster in cyan/magenta neon.',
  },
  {
    id: 'pricing-indigo',
    name: 'Pricing Page — Indigo Pro',
    templateId: 'tmpl-pricing-3tier',
    themeId: 'indigo-pro',
    description: '3-tier landscape pricing with Pro highlighted.',
  },
  {
    id: 'pricing-mono',
    name: 'Pricing Page — Editorial Mono',
    templateId: 'tmpl-pricing-3tier',
    themeId: 'mono-print',
    description: 'Same pricing layout but light, mono, editorial.',
  },
  {
    id: 'quote-sunset',
    name: 'Quote Card — Sunset Glow',
    templateId: 'tmpl-quote-card',
    themeId: 'sunset-glow',
    description: 'Warm-toned testimonial for product launch posts.',
  },
  {
    id: 'carousel-ocean',
    name: 'Launch Carousel — Ocean Blue',
    templateId: 'tmpl-instagram-carousel',
    themeId: 'ocean-blue',
    description: '4-slide narrative on a calm teal palette.',
  },
  {
    id: 'kpi-forest',
    name: 'KPI Dashboard — Forest Deep',
    templateId: 'tmpl-kpi-dashboard',
    themeId: 'forest-deep',
    description: 'Interactive HTML KPI dashboard in deep greens.',
  },
  {
    id: 'report-clean',
    name: 'Sectioned Report — Light Clean',
    templateId: 'tmpl-sectioned-report',
    themeId: 'light-clean',
    description: 'Clean light-mode interactive report with sidebar nav.',
  },
];
