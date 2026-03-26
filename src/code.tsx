type ReviewStatus = 'unmet' | 'partial' | 'met';
type Importance = 'high' | 'medium' | 'low';

type CriterionDefinition = {
  id: string;
  name: string;
  description: string;
  importance: Importance;
  weight: number;
  category: 'ux' | 'layout' | 'a11y' | 'handoff';
};

type CriterionResult = CriterionDefinition & {
  status: ReviewStatus;
  earnedWeight: number;
  summary: string;
  suggestedAction?: string;
  evidence: string[];
};

type ReviewResult = {
  sectionNodeId: string;
  sectionName: string;
  reviewedAt: string;
  score: number;
  criteria: CriterionResult[];
  counts: {
    unmet: number;
    partial: number;
    met: number;
  };
  warnings: string[];
};

type ReviewState = 'idle' | 'loading' | 'success' | 'partial' | 'error';

const CRITERIA: CriterionDefinition[] = [
  {
    id: 'empty-zero-states',
    name: 'Empty & Zero States',
    description: 'Checks whether relevant empty states exist for the reviewed flows.',
    importance: 'high',
    weight: 10,
    category: 'ux'
  },
  {
    id: 'loading-states',
    name: 'Loading States',
    description: 'Checks whether loading, skeleton or progress states are represented.',
    importance: 'high',
    weight: 8,
    category: 'ux'
  },
  {
    id: 'responsive-adaptation',
    name: 'Responsive Adaptation',
    description: 'Checks whether the section includes variants for different breakpoints or platforms.',
    importance: 'high',
    weight: 10,
    category: 'layout'
  },
  {
    id: 'touch-target-size',
    name: 'Touch Target Size',
    description: 'Checks whether likely interactive controls meet safe tap target sizes.',
    importance: 'high',
    weight: 10,
    category: 'a11y'
  },
  {
    id: 'color-contrast',
    name: 'Color Contrast',
    description: 'Checks contrast for text layers against the nearest solid background.',
    importance: 'high',
    weight: 12,
    category: 'a11y'
  },
  {
    id: 'design-system-alignment',
    name: 'Design System Alignment',
    description: 'Checks whether the section primarily uses component instances instead of raw layers.',
    importance: 'high',
    weight: 14,
    category: 'handoff'
  },
  {
    id: 'component-architecture',
    name: 'Component-Based Architecture',
    description: 'Checks whether repeated patterns are represented as instances/components.',
    importance: 'high',
    weight: 12,
    category: 'handoff'
  },
  {
    id: 'design-tokens',
    name: 'Design Tokens / Variables',
    description: 'Checks whether variable bindings are used for key visual properties.',
    importance: 'high',
    weight: 12,
    category: 'handoff'
  },
  {
    id: 'naming',
    name: 'Layer & Frame Naming',
    description: 'Checks whether naming is meaningful and avoids auto-generated labels.',
    importance: 'medium',
    weight: 6,
    category: 'handoff'
  },
  {
    id: 'dev-ready',
    name: 'Dev-Ready Status',
    description: 'Checks for explicit ready/final markers and absence of WIP indicators.',
    importance: 'medium',
    weight: 6,
    category: 'handoff'
  }
];

const COLORS = {
  background: '#FFFFFF',
  border: '#E8E8EC',
  text: '#1F1F24',
  textMuted: '#767A84',
  tabBg: '#F5F5F8',
  buttonBg: '#1F1F24',
  buttonText: '#FFFFFF',
  unmet: '#F6528A',
  partial: '#F6C90E',
  met: '#12C98A',
  infoBg: '#F7F7FB'
};

const BAD_NAME_PATTERNS = [
  /^frame \d+$/i,
  /^group \d+$/i,
  /^rectangle \d+$/i,
  /^vector \d+$/i,
  /^copy of /i,
  /^instance \d+$/i,
  /^text \d+$/i
];

const EMPTY_KEYWORDS = ['empty', 'zero', 'no results', 'nothing', 'not found', 'no items', 'empty state'];
const LOADING_KEYWORDS = ['loading', 'skeleton', 'shimmer', 'progress', 'spinner', 'loader'];
const READY_KEYWORDS = ['ready', 'final', 'approved', 'dev ready', 'for dev'];
const WIP_KEYWORDS = ['wip', 'draft', 'old', 'archive', 'todo'];
const DEVICE_KEYWORDS = ['mobile', 'tablet', 'desktop', 'ios', 'android', 'web'];
const INTERACTIVE_KEYWORDS = ['button', 'btn', 'link', 'toggle', 'checkbox', 'radio', 'tab', 'chip', 'input'];

const { widget } = figma;
const {
  AutoLayout,
  Text,
  useSyncedState,
  usePropertyMenu,
  useWidgetNodeId
} = widget;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const int = parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function solidPaintToHex(paint: SolidPaint | null | undefined): string | null {
  if (!paint || paint.type !== 'SOLID' || paint.visible === false) {
    return null;
  }
  const r = Math.round(paint.color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(paint.color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(paint.color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function getSolidFillHex(node: SceneNode): string | null {
  if (!('fills' in node)) {
    return null;
  }
  const fills = node.fills;
  if (!Array.isArray(fills)) {
    return null;
  }
  for (const fill of fills) {
    if (fill.type === 'SOLID' && fill.visible !== false) {
      return solidPaintToHex(fill);
    }
  }
  return null;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const map = [r, g, b].map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * map[0] + 0.7152 * map[1] + 0.0722 * map[2];
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function includesKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function flattenSection(section: SectionNode): SceneNode[] {
  const nodes: SceneNode[] = [];
  const walk = (node: SceneNode) => {
    nodes.push(node);
    if ('children' in node) {
      for (const child of node.children) {
        walk(child as SceneNode);
      }
    }
  };
  for (const child of section.children) {
    walk(child as SceneNode);
  }
  return nodes;
}

function collectFrames(section: SectionNode): FrameNode[] {
  const frames: FrameNode[] = [];
  const walk = (node: SceneNode) => {
    if (node.type === 'FRAME') {
      frames.push(node);
    }
    if ('children' in node) {
      for (const child of node.children) {
        walk(child as SceneNode);
      }
    }
  };
  for (const child of section.children) {
    walk(child as SceneNode);
  }
  return frames;
}

function nearestSection(node: BaseNode | null): SectionNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'SECTION') {
      return current;
    }
    current = 'parent' in current ? current.parent : null;
  }
  return null;
}

function getWidgetNode(widgetNodeId: string): WidgetNode | null {
  const node = figma.getNodeById(widgetNodeId);
  return node && node.type === 'WIDGET' ? node : null;
}

function makeResult(
  definition: CriterionDefinition,
  status: ReviewStatus,
  summary: string,
  suggestedAction: string | undefined,
  evidence: string[]
): CriterionResult {
  const multiplier = status === 'met' ? 1 : status === 'partial' ? 0.5 : 0;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    importance: definition.importance,
    weight: definition.weight,
    category: definition.category,
    status,
    earnedWeight: definition.weight * multiplier,
    summary,
    suggestedAction,
    evidence
  };
}

function analyzeEmptyStates(section: SectionNode, nodes: SceneNode[]): CriterionResult {
  const hits = nodes
    .filter((node) => includesKeyword(node.name, EMPTY_KEYWORDS))
    .slice(0, 5)
    .map((node) => node.name);

  const textHits = nodes
    .filter((node): node is TextNode => node.type === 'TEXT')
    .filter((node) => includesKeyword(node.characters, EMPTY_KEYWORDS))
    .slice(0, 3)
    .map((node) => node.characters);

  const evidence = [...hits, ...textHits];
  if (evidence.length >= 2) {
    return makeResult(
      CRITERIA[0],
      'met',
      'Empty states are present in the reviewed section.',
      undefined,
      evidence
    );
  }
  if (evidence.length === 1) {
    return makeResult(
      CRITERIA[0],
      'partial',
      'Only part of the flow shows a clear empty or zero state.',
      'Add empty states for the remaining relevant scenarios such as no results, no items or nothing found.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[0],
    'unmet',
    `No clear empty or zero states were found in section "${section.name}".`,
    'Add explicit empty states for relevant flows and annotate how users recover from no-data situations.',
    []
  );
}

function analyzeLoadingStates(nodes: SceneNode[]): CriterionResult {
  const evidence = nodes
    .filter((node) => includesKeyword(node.name, LOADING_KEYWORDS))
    .slice(0, 5)
    .map((node) => node.name);

  if (evidence.length >= 2) {
    return makeResult(CRITERIA[1], 'met', 'Loading states are represented in the section.', undefined, evidence);
  }
  if (evidence.length === 1) {
    return makeResult(
      CRITERIA[1],
      'partial',
      'A loading pattern exists, but coverage appears incomplete.',
      'Add loading or skeleton states for the other key screens and transitions.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[1],
    'unmet',
    'No explicit loading or skeleton states were found.',
    'Add loaders, skeletons or progress indicators for the main data-fetching and transition moments.',
    []
  );
}

function normalizeBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(mobile|tablet|desktop|ios|android|web)\b/g, '')
    .replace(/[0-9]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function analyzeResponsive(frames: FrameNode[]): CriterionResult {
  const groups = new Map<string, Set<string>>();
  for (const frame of frames) {
    const name = frame.name.toLowerCase();
    const matchedDevices = DEVICE_KEYWORDS.filter((keyword) => name.includes(keyword));
    if (!matchedDevices.length) {
      continue;
    }
    const key = normalizeBaseName(name);
    const bucket = groups.get(key) ?? new Set<string>();
    matchedDevices.forEach((value) => bucket.add(value));
    groups.set(key, bucket);
  }

  const qualifying = [...groups.entries()].filter(([, devices]) => devices.size >= 2);
  const evidence = qualifying.slice(0, 4).map(([name, devices]) => `${name}: ${[...devices].join(', ')}`);

  if (qualifying.length >= 2) {
    return makeResult(CRITERIA[2], 'met', 'Responsive or platform-specific variants were detected.', undefined, evidence);
  }
  if (qualifying.length === 1) {
    return makeResult(
      CRITERIA[2],
      'partial',
      'Some responsive adaptation exists, but only for part of the reviewed section.',
      'Add missing mobile/tablet/desktop or platform variants for the remaining key screens.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[2],
    'unmet',
    'No reliable evidence of responsive or platform variants was found.',
    'Add explicit variants or clearly named breakpoints/platform versions for the main screens.',
    []
  );
}

function analyzeTouchTargets(nodes: SceneNode[]): CriterionResult {
  const candidates = nodes.filter((node) => {
    const name = node.name.toLowerCase();
    if (!INTERACTIVE_KEYWORDS.some((keyword) => name.includes(keyword))) {
      return false;
    }
    return 'width' in node && 'height' in node;
  }) as Array<SceneNode & DimensionAndPositionMixin>;

  if (!candidates.length) {
    return makeResult(
      CRITERIA[3],
      'partial',
      'No clearly named interactive controls were detected, so tap target coverage is uncertain.',
      'Use clearer naming for buttons and interactive controls so the widget can validate target size reliably.',
      []
    );
  }

  const passing = candidates.filter((node) => node.width >= 44 && node.height >= 44);
  const ratio = passing.length / candidates.length;
  const evidence = candidates.slice(0, 5).map((node) => `${node.name} (${Math.round(node.width)}x${Math.round(node.height)})`);

  if (ratio >= 0.85) {
    return makeResult(CRITERIA[3], 'met', 'Most detected interactive targets meet the minimum tap size.', undefined, evidence);
  }
  if (ratio >= 0.4) {
    return makeResult(
      CRITERIA[3],
      'partial',
      'Only part of the detected interactive targets meet the minimum tap size.',
      'Increase the hit area of smaller buttons, icon controls and compact actions to at least 44x44.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[3],
    'unmet',
    'Most detected interactive targets are below the minimum recommended tap size.',
    'Resize interactive controls or wrap them in larger hit areas to improve mobile usability.',
    evidence
  );
}

function findNearestSolidBackground(node: SceneNode): string | null {
  let current: BaseNode | null = node.parent;
  while (current && current.type !== 'PAGE') {
    if ('fills' in current) {
      const fill = getSolidFillHex(current as SceneNode);
      if (fill) {
        return fill;
      }
    }
    current = 'parent' in current ? current.parent : null;
  }
  return COLORS.background;
}

function analyzeContrast(nodes: SceneNode[]): CriterionResult {
  const textNodes = nodes.filter((node) => node.type === 'TEXT') as TextNode[];
  const sample = textNodes.slice(0, 30);
  const measurable: number[] = [];
  const evidence: string[] = [];

  for (const node of sample) {
    const fills = node.fills;
    if (!Array.isArray(fills) || !fills.length || fills[0].type !== 'SOLID') {
      continue;
    }
    const fg = solidPaintToHex(fills[0]);
    const bg = findNearestSolidBackground(node);
    if (!fg || !bg) {
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    measurable.push(ratio);
    if (evidence.length < 5) {
      evidence.push(`${node.name || 'Text'}: ${ratio.toFixed(2)}:1`);
    }
  }

  if (!measurable.length) {
    return makeResult(
      CRITERIA[4],
      'partial',
      'Contrast could be measured only for a limited set of text layers.',
      'Use solid text/background fills for key text elements or keep contrast-friendly text styles in variables.',
      []
    );
  }

  const passing = measurable.filter((ratio) => ratio >= 4.5).length;
  const score = passing / measurable.length;
  if (score >= 0.85) {
    return makeResult(CRITERIA[4], 'met', 'Most measurable text layers pass the contrast threshold.', undefined, evidence);
  }
  if (score >= 0.45) {
    return makeResult(
      CRITERIA[4],
      'partial',
      'Contrast passes for some text layers, but several important pairs likely need improvement.',
      'Increase foreground/background contrast for weak text pairs, especially muted text on light surfaces.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[4],
    'unmet',
    'Most measurable text layers fail the contrast threshold.',
    'Raise contrast for body text and key UI labels to meet accessibility guidelines.',
    evidence
  );
}

function analyzeDesignSystem(nodes: SceneNode[]): CriterionResult {
  const instances = nodes.filter((node) => node.type === 'INSTANCE' || node.type === 'COMPONENT');
  const visualNodes = nodes.filter((node) => ['FRAME', 'INSTANCE', 'COMPONENT', 'GROUP'].includes(node.type));
  const ratio = visualNodes.length ? instances.length / visualNodes.length : 0;
  const evidence = instances.slice(0, 5).map((node) => node.name);

  if (ratio >= 0.45) {
    return makeResult(CRITERIA[5], 'met', 'The reviewed section primarily uses components and instances.', undefined, evidence);
  }
  if (ratio >= 0.2) {
    return makeResult(
      CRITERIA[5],
      'partial',
      'Components are used, but a large share of the UI still appears to be custom-drawn.',
      'Replace repeated raw layers with official design system components where possible.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[5],
    'unmet',
    'The reviewed section shows very limited usage of reusable components.',
    'Rebuild repeated UI using the design system library instead of local raw layers.',
    evidence
  );
}

function analyzeComponentArchitecture(nodes: SceneNode[]): CriterionResult {
  const repeated = new Map<string, number>();
  for (const node of nodes) {
    const name = node.name.trim();
    if (!name || name.length < 3) {
      continue;
    }
    repeated.set(name, (repeated.get(name) ?? 0) + 1);
  }
  const repeatedNames = [...repeated.entries()].filter(([, count]) => count >= 3).map(([name]) => name);
  const repeatedNodes = nodes.filter((node) => repeatedNames.includes(node.name));
  const componentBacked = repeatedNodes.filter((node) => node.type === 'INSTANCE' || node.type === 'COMPONENT');
  const ratio = repeatedNodes.length ? componentBacked.length / repeatedNodes.length : 1;
  const evidence = repeatedNames.slice(0, 5);

  if (!repeatedNodes.length) {
    return makeResult(
      CRITERIA[6],
      'partial',
      'Few repeated patterns were detected, so component architecture could not be evaluated deeply.',
      'Use consistent naming for repeated UI patterns so the widget can better detect component reuse.',
      []
    );
  }
  if (ratio >= 0.75) {
    return makeResult(CRITERIA[6], 'met', 'Repeated UI patterns are mostly backed by components.', undefined, evidence);
  }
  if (ratio >= 0.35) {
    return makeResult(
      CRITERIA[6],
      'partial',
      'Some repeated patterns use components, but many are still duplicated as raw layers.',
      'Convert repeated cards, rows, buttons and cells into reusable components or instances.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[6],
    'unmet',
    'Repeated UI patterns are mostly duplicated instead of being component-based.',
    'Refactor repeated patterns into reusable components to improve consistency and handoff quality.',
    evidence
  );
}

function hasBoundVariables(node: SceneNode): boolean {
  return 'boundVariables' in node && !!node.boundVariables && Object.keys(node.boundVariables).length > 0;
}

function analyzeVariables(nodes: SceneNode[]): CriterionResult {
  const candidates = nodes.filter((node) => ['TEXT', 'FRAME', 'RECTANGLE', 'INSTANCE', 'COMPONENT'].includes(node.type));
  const bound = candidates.filter(hasBoundVariables);
  const ratio = candidates.length ? bound.length / candidates.length : 0;
  const evidence = bound.slice(0, 5).map((node) => node.name);

  if (ratio >= 0.35) {
    return makeResult(CRITERIA[7], 'met', 'Variable bindings are used across key visual layers.', undefined, evidence);
  }
  if (ratio >= 0.12) {
    return makeResult(
      CRITERIA[7],
      'partial',
      'Variables are used, but only for part of the reviewed section.',
      'Bind colors, typography and shared styling properties to variables instead of hardcoded values.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[7],
    'unmet',
    'Very few nodes appear to use variables or tokens.',
    'Adopt variables for colors, text styles and other shared properties to make the handoff more robust.',
    evidence
  );
}

function analyzeNaming(nodes: SceneNode[]): CriterionResult {
  const namedNodes = nodes.filter((node) => ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'SECTION'].includes(node.type));
  const badNodes = namedNodes.filter((node) => BAD_NAME_PATTERNS.some((pattern) => pattern.test(node.name.trim())));
  const ratio = namedNodes.length ? badNodes.length / namedNodes.length : 0;
  const evidence = badNodes.slice(0, 5).map((node) => node.name);

  if (ratio <= 0.1) {
    return makeResult(CRITERIA[8], 'met', 'Most frames and layers use meaningful names.', undefined, []);
  }
  if (ratio <= 0.3) {
    return makeResult(
      CRITERIA[8],
      'partial',
      'Naming is mixed: some frames are clear, while others still use autogenerated labels.',
      'Rename autogenerated frames and groups to reflect screen purpose and content.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[8],
    'unmet',
    'A large share of frames and groups still use autogenerated naming.',
    'Replace names like Frame 12 or Rectangle 7 with clear product-oriented labels.',
    evidence
  );
}

function analyzeDevReady(section: SectionNode, frames: FrameNode[]): CriterionResult {
  const combined = [section.name, ...frames.slice(0, 30).map((frame) => frame.name)].join(' | ').toLowerCase();
  const readyHits = READY_KEYWORDS.filter((keyword) => combined.includes(keyword));
  const wipHits = WIP_KEYWORDS.filter((keyword) => combined.includes(keyword));
  const evidence = [...readyHits.map((value) => `ready:${value}`), ...wipHits.map((value) => `wip:${value}`)];

  if (readyHits.length && !wipHits.length) {
    return makeResult(CRITERIA[9], 'met', 'The section has clear ready/final markers and no obvious WIP signals.', undefined, evidence);
  }
  if (readyHits.length || wipHits.length) {
    return makeResult(
      CRITERIA[9],
      'partial',
      'The section has mixed readiness signals and could be clearer for handoff.',
      'Use a consistent final/ready marker and remove outdated draft or WIP labels from delivery frames.',
      evidence
    );
  }
  return makeResult(
    CRITERIA[9],
    'partial',
    'No explicit ready or WIP markers were found, so delivery status is unclear.',
    'Add a clear dev-ready convention for final sections or delivery frames.',
    []
  );
}

function analyzeSection(section: SectionNode): ReviewResult {
  const nodes = flattenSection(section);
  const frames = collectFrames(section);
  const warnings: string[] = [];

  if (!frames.length) {
    warnings.push('No frames were found inside the section. Analysis coverage is limited.');
  }

  const criteria = [
    analyzeEmptyStates(section, nodes),
    analyzeLoadingStates(nodes),
    analyzeResponsive(frames),
    analyzeTouchTargets(nodes),
    analyzeContrast(nodes),
    analyzeDesignSystem(nodes),
    analyzeComponentArchitecture(nodes),
    analyzeVariables(nodes),
    analyzeNaming([section as unknown as SceneNode, ...nodes]),
    analyzeDevReady(section, frames)
  ];

  const score = Math.round(criteria.reduce((sum, item) => sum + item.earnedWeight, 0));
  const counts = criteria.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { unmet: 0, partial: 0, met: 0 }
  );

  if (criteria.some((item) => item.status === 'partial')) {
    warnings.push('Some criteria were evaluated with heuristic confidence only. Review the evidence before acting on every recommendation.');
  }

  return {
    sectionNodeId: section.id,
    sectionName: section.name,
    reviewedAt: new Date().toISOString(),
    score,
    criteria,
    counts,
    warnings
  };
}

function statusLabel(status: ReviewStatus): string {
  if (status === 'met') {
    return 'Met';
  }
  if (status === 'partial') {
    return 'Partially Met';
  }
  return 'Unmet';
}

function statusColor(status: ReviewStatus): string {
  if (status === 'met') {
    return COLORS.met;
  }
  if (status === 'partial') {
    return COLORS.partial;
  }
  return COLORS.unmet;
}

function importanceLabel(value: Importance): string {
  return value === 'high' ? 'High' : value === 'medium' ? 'Medium' : 'Low';
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Not reviewed yet';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function Widget() {
  const widgetNodeId = useWidgetNodeId();
  const [reviewState, setReviewState] = useSyncedState<ReviewState>('review-state', 'idle');
  const [activeTab, setActiveTab] = useSyncedState<'all' | ReviewStatus>('active-tab', 'all');
  const [result, setResult] = useSyncedState<ReviewResult | null>('review-result', null);
  const [errorMessage, setErrorMessage] = useSyncedState<string>('error-message', '');

  usePropertyMenu(
    [
      { itemType: 'action', propertyName: 'review', tooltip: result ? 'Re-review section' : 'Review section' },
      { itemType: 'action', propertyName: 'all', tooltip: 'Show all findings' },
      { itemType: 'action', propertyName: 'unmet', tooltip: 'Show unmet findings' },
      { itemType: 'action', propertyName: 'partial', tooltip: 'Show partial findings' },
      { itemType: 'action', propertyName: 'met', tooltip: 'Show met findings' }
    ],
    ({ propertyName }) => {
      if (propertyName === 'review') {
        runReview();
      } else if (propertyName === 'all' || propertyName === 'unmet' || propertyName === 'partial' || propertyName === 'met') {
        setActiveTab(propertyName);
      }
    }
  );

  const runReview = () => {
    try {
      setReviewState('loading');
      setErrorMessage('');

      const widgetNode = getWidgetNode(widgetNodeId);
      const section = nearestSection(widgetNode);
      if (!section) {
        throw new Error('Place the widget inside a section to review its flows.');
      }

      const reviewResult = analyzeSection(section);
      setResult(reviewResult);
      setReviewState(reviewResult.warnings.length ? 'partial' : 'success');
    } catch (error) {
      setReviewState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const filteredCriteria = result?.criteria.filter((criterion) => {
    if (activeTab === 'all') {
      return true;
    }
    return criterion.status === activeTab;
  }) ?? [];
  const totalBars = Math.max((result?.counts.unmet ?? 0) + (result?.counts.partial ?? 0) + (result?.counts.met ?? 0), 1);
  const barWidth = 712;
  const unmetWidth = result ? Math.max(Math.round((result.counts.unmet / totalBars) * barWidth), result.counts.unmet ? 48 : 0) : Math.round(barWidth / 3);
  const partialWidth = result ? Math.max(Math.round((result.counts.partial / totalBars) * barWidth), result.counts.partial ? 48 : 0) : Math.round(barWidth / 3);
  const metWidth = result ? Math.max(barWidth - unmetWidth - partialWidth, result.counts.met ? 48 : 0) : barWidth - Math.round(barWidth / 3) * 2;

  return (
    <AutoLayout
      name="DesignReviewWidget"
      direction="vertical"
      width={760}
      fill={COLORS.background}
      stroke={COLORS.border}
      cornerRadius={24}
      padding={24}
      spacing={24}
    >
      <AutoLayout direction="horizontal" width="fill-parent" verticalAlignItems="center" horizontalAlignItems="space-between">
        <AutoLayout direction="vertical" spacing={6}>
          <Text fontSize={28} fontWeight={700} fill={COLORS.text}>Design review</Text>
          <Text fontSize={14} fill={COLORS.textMuted}>
            {result ? `Last reviewed: ${formatDate(result.reviewedAt)}` : 'Last reviewed: not yet'}
          </Text>
        </AutoLayout>
        <AutoLayout
          fill={COLORS.buttonBg}
          cornerRadius={14}
          padding={{ vertical: 14, horizontal: 18 }}
          onClick={runReview}
        >
          <Text fontSize={14} fontWeight={700} fill={COLORS.buttonText}>
            {reviewState === 'loading' ? 'Reviewing...' : result ? 'Re-review' : 'Review flow'}
          </Text>
        </AutoLayout>
      </AutoLayout>

      {reviewState === 'error' ? (
        <AutoLayout fill={COLORS.infoBg} stroke={COLORS.border} cornerRadius={16} padding={16}>
          <Text fontSize={14} fill={COLORS.text}>{errorMessage}</Text>
        </AutoLayout>
      ) : null}

      <AutoLayout direction="vertical" spacing={16} width="fill-parent">
        <Text fontSize={24} fontWeight={700} fill={COLORS.text}>
          {result ? `${result.score}/100` : '0/100'}
        </Text>
        <Text fontSize={14} fill={COLORS.textMuted}>Design score</Text>

        <AutoLayout direction="horizontal" width="fill-parent" height={32} cornerRadius={16} overflow="hidden">
          <AutoLayout
            width={unmetWidth}
            fill={COLORS.unmet}
            padding={{ horizontal: 10, vertical: 6 }}
          >
            <Text fontSize={14} fontWeight={700} fill={COLORS.text}>{result?.counts.unmet ?? 0}</Text>
          </AutoLayout>
          <AutoLayout
            width={partialWidth}
            fill={COLORS.partial}
            padding={{ horizontal: 10, vertical: 6 }}
          >
            <Text fontSize={14} fontWeight={700} fill={COLORS.text}>{result?.counts.partial ?? 0}</Text>
          </AutoLayout>
          <AutoLayout
            width={metWidth}
            fill={COLORS.met}
            padding={{ horizontal: 10, vertical: 6 }}
          >
            <Text fontSize={14} fontWeight={700} fill={COLORS.text}>{result?.counts.met ?? 0}</Text>
          </AutoLayout>
        </AutoLayout>

        <AutoLayout direction="horizontal" spacing={12} width="fill-parent">
          {[
            { key: 'unmet' as const, label: 'Unmet', count: result?.counts.unmet ?? 0 },
            { key: 'partial' as const, label: 'Partially Met', count: result?.counts.partial ?? 0 },
            { key: 'met' as const, label: 'Met', count: result?.counts.met ?? 0 },
            { key: 'all' as const, label: 'All', count: result?.criteria.length ?? 0 }
          ].map((tab) => (
            <AutoLayout
              key={tab.key}
              fill={activeTab === tab.key ? COLORS.infoBg : COLORS.background}
              stroke={activeTab === tab.key ? COLORS.border : undefined}
              cornerRadius={999}
              padding={{ horizontal: 14, vertical: 10 }}
              spacing={8}
              onClick={() => setActiveTab(tab.key)}
            >
              <Text fontSize={14} fontWeight={600} fill={COLORS.text}>{tab.label}</Text>
              <AutoLayout
                fill={tab.key === 'all' ? COLORS.tabBg : statusColor(tab.key as ReviewStatus)}
                cornerRadius={999}
                padding={{ horizontal: 8, vertical: 4 }}
              >
                <Text fontSize={12} fontWeight={700} fill={COLORS.text}>{tab.count}</Text>
              </AutoLayout>
            </AutoLayout>
          ))}
        </AutoLayout>
      </AutoLayout>

      <AutoLayout direction="vertical" width="fill-parent" spacing={12}>
        {filteredCriteria.length ? filteredCriteria.map((criterion) => (
          <AutoLayout
            key={criterion.id}
            direction="vertical"
            width="fill-parent"
            fill={COLORS.background}
            stroke={COLORS.border}
            cornerRadius={18}
            padding={18}
            spacing={14}
          >
            <AutoLayout direction="horizontal" width="fill-parent" horizontalAlignItems="space-between">
              <AutoLayout direction="horizontal" spacing={10} verticalAlignItems="center">
                <AutoLayout width={12} height={12} cornerRadius={4} fill={statusColor(criterion.status)} />
                <Text fontSize={18} fontWeight={700} fill={COLORS.text}>{criterion.name}</Text>
              </AutoLayout>
              <Text fontSize={14} fill={COLORS.textMuted}>
                Importance: {importanceLabel(criterion.importance)}
              </Text>
            </AutoLayout>

            <AutoLayout direction="vertical" spacing={8} width="fill-parent">
              <Text fontSize={14} fontWeight={600} fill={COLORS.text}>Status: {statusLabel(criterion.status)}</Text>
              <Text fontSize={14} fill={COLORS.text}>Summary: {criterion.summary}</Text>
              {criterion.suggestedAction ? (
                <Text fontSize={14} fill={COLORS.text}>
                  Suggested Action: {criterion.suggestedAction}
                </Text>
              ) : null}
              {criterion.evidence.length ? (
                <Text fontSize={13} fill={COLORS.textMuted}>
                  Evidence: {criterion.evidence.join(' | ')}
                </Text>
              ) : null}
            </AutoLayout>
          </AutoLayout>
        )) : (
          <AutoLayout fill={COLORS.infoBg} stroke={COLORS.border} cornerRadius={16} padding={16}>
            <Text fontSize={14} fill={COLORS.text}>
              {result ? 'No findings in this tab yet.' : 'Run Review flow to analyze the section where the widget is placed.'}
            </Text>
          </AutoLayout>
        )}
      </AutoLayout>

      {result?.warnings.length ? (
        <AutoLayout direction="vertical" width="fill-parent" fill={COLORS.infoBg} stroke={COLORS.border} cornerRadius={16} padding={16} spacing={8}>
          <Text fontSize={16} fontWeight={700} fill={COLORS.text}>Warnings</Text>
          {result.warnings.map((warning, index) => (
            <Text key={`${warning}-${index}`} fontSize={13} fill={COLORS.textMuted}>{warning}</Text>
          ))}
        </AutoLayout>
      ) : null}
    </AutoLayout>
  );
}

widget.register(Widget);
