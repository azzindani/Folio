# REPORT_ENGINE.md — Folio Report Document Type
# Extends the Folio Design Engine with data-driven, interactive report output
# Phase 2 feature set

---

## 1. OVERVIEW

Report documents extend the existing `design/v1` spec with:
- `type: report` meta field
- Data binding pipeline (`$data.*` token resolution)
- 7 interactive layer types powered by embedded JS libraries
- Navigation runtime (sidebar / topbar / tabs / dots)
- Single-file HTML export with all runtime inlined

```
YAML spec  →  data loader  →  data binder  →  renderer  →  interactive HTML
                ↑ CSV/Excel/JSON sources
```

---

## 2. REPORT DOCUMENT SPEC

```yaml
_protocol: design/v1
meta:
  id: report-001
  name: Sales Dashboard Q1
  type: report            # new type alongside poster/carousel/motion
  created: 2026-01-01T00:00:00Z
  modified: 2026-01-01T00:00:00Z

document:
  width: 1440
  height: 900
  unit: px
  dpi: 96

report:
  layout: sidebar          # paged | scroll | tabs | sidebar
  navigation:
    type: sidebar          # sidebar | topbar | tabs | dots
    width: 240             # sidebar only
    labels: true
    collapsible: true
  data:
    sources:
      - id: sales
        type: csv
        path: data/sales.csv
      - id: metrics
        type: json
        path: data/metrics.json
      - id: inline
        type: inline
        rows:
          - { label: "Q1", value: 420 }
          - { label: "Q2", value: 510 }

theme:
  ref: dark-pro

pages:
  - id: overview
    label: Overview
    layers: [...]
  - id: detail
    label: Detail
    layers: [...]
```

### 2.1 Layout Options

| layout | description |
|---|---|
| `paged` | Fixed-size pages, pagination controls, like carousel |
| `scroll` | Single long scroll, sections separated by anchors |
| `tabs` | Horizontal tab strip, each page = one tab |
| `sidebar` | Left nav drawer, each page = nav item |

### 2.2 Navigation Spec

```yaml
navigation:
  type: sidebar | topbar | tabs | dots
  width: 240           # sidebar only
  position: left | right  # sidebar only (default: left)
  labels: true
  collapsible: true
  show_icons: true
  active_color: "#6c5ce7"
  background: "#1a1a2e"
```

---

## 3. DATA BINDING

### 3.1 Data Sources

```yaml
sources:
  - id: sales          # referenced as $data.sales
    type: csv          # csv | excel | json | inline | api
    path: data/sales.csv
    sheet: Sheet1      # excel only
    range: A1:Z100     # excel only
    headers: true      # csv/excel: first row = headers
    delimiter: ","     # csv only

  - id: kpis
    type: inline
    rows:
      - { metric: "Revenue", value: 142000, delta: 12.4 }
      - { metric: "Users",   value: 8420,   delta: -2.1 }
```

### 3.2 Data Reference Syntax

```
$data.sales                     → full dataset (array of row objects)
$data.sales[0].revenue          → first row, field "revenue"
$data.sales.length              → row count
$agg.sales.sum(revenue)         → aggregation
$agg.sales.avg(revenue)
$agg.sales.min(revenue)
$agg.sales.max(revenue)
$agg.sales.count()
$agg.sales.groupby(region).sum(revenue)  → grouped aggregation
```

### 3.3 Aggregate Operations

| op | description |
|---|---|
| `sum(field)` | Sum of numeric field |
| `avg(field)` | Average of numeric field |
| `min(field)` | Minimum value |
| `max(field)` | Maximum value |
| `count()` | Row count |
| `groupby(field).op(field)` | Grouped aggregate |
| `filter(expr).op(field)` | Filtered aggregate |
| `sort(field, asc).slice(n)` | Sorted + limited rows |

---

## 4. NEW LAYER TYPES

### 4.1 `interactive_chart`

Powered by Plotly.js (inlined in export). Falls back to static SVG in poster/carousel modes.

```yaml
- id: rev-chart
  type: interactive_chart
  z: 10
  x: 40
  y: 80
  width: 680
  height: 400
  chart_type: bar          # bar | line | area | pie | donut | scatter | heatmap | funnel | waterfall
  data_ref: $data.sales
  x_field: month
  y_field: revenue
  color_field: region      # optional grouping
  title: Monthly Revenue
  x_label: Month
  y_label: Revenue ($)
  color_scheme: blues      # blues | greens | reds | spectral | viridis | custom
  custom_colors: ["#6c5ce7", "#a29bfe"]
  legend: true
  grid: true
  interactive: true
  animate: true
```

### 4.2 `interactive_table`

Powered by Tabulator.js. Supports sort, filter, pagination.

```yaml
- id: data-table
  type: interactive_table
  z: 10
  x: 40
  y: 500
  width: 1360
  height: 360
  data_ref: $data.sales
  columns:
    - field: month
      title: Month
      width: 120
      sortable: true
    - field: revenue
      title: Revenue
      width: 140
      formatter: currency    # currency | number | percent | date | badge
      align: right
    - field: delta
      title: Change
      width: 100
      formatter: delta       # shows +/- with color
  pagination: true
  page_size: 20
  filterable: true
  exportable: true           # adds CSV download button
  theme: midnight            # midnight | bootstrap | bulma | semanticui
```

### 4.3 `rich_text`

HTML-formatted text block. Supports markdown + inline HTML.

```yaml
- id: section-title
  type: rich_text
  z: 10
  x: 40
  y: 40
  width: 900
  height: 200
  content: |
    ## Executive Summary

    Revenue grew **12.4%** YoY driven by enterprise expansion.
    Key highlights:
    - APAC region up 28%
    - Churn rate down to **2.1%**
  format: markdown           # markdown | html
  font_family: Inter
  font_size: 16
  line_height: 1.6
  color: "#e0e0e0"
  link_color: "#6c5ce7"
```

### 4.4 `kpi_card`

Single-metric display card with optional sparkline and delta.

```yaml
- id: kpi-revenue
  type: kpi_card
  z: 10
  x: 40
  y: 40
  width: 300
  height: 180
  label: Total Revenue
  value: $agg.sales.sum(revenue)
  format: currency           # currency | number | percent | custom
  currency: USD
  decimals: 0
  delta: $agg.sales.avg(delta)
  delta_format: percent
  delta_positive_color: "#00b894"
  delta_negative_color: "#e17055"
  sparkline_data: $data.sales
  sparkline_field: revenue
  sparkline_color: "#6c5ce7"
  icon: trending-up          # lucide icon name
  background: "#1e1e3a"
  text_color: "#ffffff"
  border_radius: 12
```

### 4.5 `map`

Leaflet.js map with marker/heatmap/choropleth overlays.

```yaml
- id: region-map
  type: map
  z: 10
  x: 40
  y: 80
  width: 700
  height: 450
  center: [20, 0]            # [lat, lng]
  zoom: 2
  tile_provider: osm         # osm | carto-dark | carto-light | stamen-toner
  overlays:
    - type: markers
      data_ref: $data.regions
      lat_field: lat
      lng_field: lng
      label_field: name
      value_field: revenue
      color: "#6c5ce7"
    - type: heatmap
      data_ref: $data.events
      lat_field: lat
      lng_field: lng
      intensity_field: count
```

### 4.6 `embed_code`

Sandboxed iframe for custom HTML/JS widgets.

```yaml
- id: custom-widget
  type: embed_code
  z: 10
  x: 40
  y: 80
  width: 600
  height: 400
  html: |
    <div id="root"></div>
    <script>
      document.getElementById('root').textContent = 'Hello from embed';
    </script>
  sandbox: true              # if true, wrapped in srcdoc iframe
  allow_scripts: true
```

### 4.7 `popup`

Modal/drawer triggered by button click or navigation event.

```yaml
- id: detail-modal
  type: popup
  z: 100
  x: 200
  y: 100
  width: 800
  height: 600
  trigger_id: open-detail-btn   # id of the layer that opens this popup
  trigger_event: click
  modal: true                    # true = backdrop overlay
  close_on_backdrop: true
  animation: fade                # fade | slide-up | slide-right
  layers:
    - id: modal-title
      type: text
      z: 10
      x: 40
      y: 40
      width: 720
      height: 60
      content: { type: plain, value: Detail View }
      style: { font_size: 28, color: "#ffffff", font_weight: 700 }
```

---

## 5. INTERACTIVE HTML RUNTIME

The export bundle inlines all runtime JS libraries:

| library | version | use |
|---|---|---|
| Plotly.js | 2.x | interactive_chart |
| Tabulator | 6.x | interactive_table |
| Leaflet | 1.9 | map |
| marked | 9.x | rich_text markdown |
| KaTeX | 0.16 | math rendering |
| highlight.js | 11.x | code highlighting |

### 5.1 `window.Folio` Runtime API

```javascript
window.Folio = {
  data: {
    get(sourceId)          // → raw dataset array
    query(expr)            // → evaluate $data.* expression
    agg(expr)              // → evaluate $agg.* expression
  },
  nav: {
    goto(pageId)           // navigate to page
    current()             // → current page id
    on('change', cb)      // page change listener
  },
  layers: {
    show(layerId)
    hide(layerId)
    toggle(layerId)
    setData(layerId, data) // replace layer's bound data
  }
}
```

---

## 6. MCP TOOLS (Phase 2)

New MCP tools for report generation:

| tool | description |
|---|---|
| `generate_report` | Create report spec from brief + data |
| `generate_report_from_file` | Auto-analyze CSV/JSON + generate |
| `add_report_page` | Append page to report |
| `bind_data` | Wire data source to layer |
| `preview_data` | Sample rows from data source |
| `export_report` | Export as interactive HTML |

---

## 7. FILE STRUCTURE

```
project/
  data/                    # data sources
    sales.csv
    metrics.json
  reports/
    dashboard.design.yaml  # report spec
    dashboard.html         # exported interactive report
  designs/                 # standard poster/carousel designs
  themes/
  components/
```

---

## 8. RENDERER STRATEGY

```
Report mode  → foreignObject wrappers → interactive HTML elements
Poster mode  → static SVG fallback (no interactivity)
Export HTML  → standalone file, all JS inlined, no CDN
Export PDF   → Puppeteer render of HTML export
Export PNG   → dom-to-image of first page
```

Layer rendering dispatch:
1. `interactive_chart` → `<div class="folio-chart">` in foreignObject → Plotly.newPlot()
2. `interactive_table` → `<div class="folio-table">` in foreignObject → new Tabulator()
3. `rich_text` → `<div class="folio-richtext">` in foreignObject → marked.parse()
4. `kpi_card` → `<div class="folio-kpi">` in foreignObject → template HTML
5. `map` → `<div class="folio-map">` in foreignObject → L.map()
6. `embed_code` → `<iframe srcdoc="...">` in foreignObject
7. `popup` → `<div class="folio-popup">` appended to body, shown/hidden via JS

---

## 9. IMPLEMENTATION STATUS

| feature | status |
|---|---|
| types.ts extensions | ✓ complete |
| src/report/ module | ✓ skeleton |
| renderer stubs (foreignObject) | ✓ complete |
| data loader | ✓ complete |
| data normalizer | ✓ complete |
| aggregator | ✓ complete |
| binder | ✓ complete |
| navigation runtime | ✓ skeleton |
| interactive HTML export | Phase 2 |
| MCP tools | Phase 2 |
