import { afterEach, describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from 'flowbite-react';
import { flowbiteTheme } from '../styles/flowbite-theme';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import StatusPill from '../components/ui/StatusPill';
import CotMarker from '../components/ui/CotMarker';
import Surface from '../components/ui/Surface';
import Toggle from '../components/ui/Toggle';
import Input from '../components/ui/Input';

const BANNED_CLASS_PATTERNS = [
  /(^|\s)(bg|text|border|ring|divide|fill|stroke|placeholder|from|to|via)-blue(-\d+)?(\s|$)/,
  /(^|\s)(bg|text|border|ring|divide|fill|stroke|placeholder|from|to|via)-white(\s|$)/,
];

const BANNED_INLINE_STYLES = [
  /#fff(\s|;|$)/i,
  /#ffffff(\s|;|$)/i,
  /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i,
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[\d.]+\s*\)/i,
  /hsl\(\s*0\s*,\s*0%\s*,\s*100%\s*\)/i,
  /hsla\(\s*0\s*,\s*0%\s*,\s*100%\s*,\s*[\d.]+\s*\)/i,
];

function findBannedNode(root: HTMLElement): { kind: string; value: string } | null {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    const classAttr = el.getAttribute('class') ?? '';
    for (const re of BANNED_CLASS_PATTERNS) {
      if (re.test(classAttr)) return { kind: 'class', value: classAttr };
    }
    const styleAttr = el.getAttribute('style') ?? '';
    for (const re of BANNED_INLINE_STYLES) {
      if (re.test(styleAttr)) return { kind: 'style', value: styleAttr };
    }
  }
  return null;
}

export function renderInLd(node: React.ReactNode) {
  document.documentElement.setAttribute('data-theme', 'ld');
  return render(<ThemeProvider theme={flowbiteTheme}>{node}</ThemeProvider>);
}

export function assertNoBannedTokens(container: HTMLElement) {
  const hit = findBannedNode(container);
  if (hit) {
    throw new Error(`LD-banned ${hit.kind} found: "${hit.value}"`);
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('LD-mode compliance', () => {
  it('scaffold renders nothing without primitives', () => {
    const { container } = renderInLd(<div />);
    assertNoBannedTokens(container);
  });

  it('Button — all variants render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <Button>primary</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="destructive">destructive</Button>
        <Button size="sm">sm</Button>
        <Button size="lg">lg</Button>
      </>
    );
    assertNoBannedTokens(container);
  });

  it('IconButton — toggled and untoggled render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <IconButton icon={<span>i</span>} label="info" />
        <IconButton icon={<span>i</span>} label="info" toggled />
      </>
    );
    assertNoBannedTokens(container);
  });

  it('StatusPill — all variants render without banned tokens in LD', () => {
    const variants = [
      'info', 'success', 'warning', 'critical', 'count',
      'cot-friendly', 'cot-hostile', 'cot-neutral', 'cot-unknown',
      'transport-wifi', 'transport-ble', 'transport-relay', 'transport-offline',
    ] as const;
    const { container } = renderInLd(
      <>{variants.map((v) => <StatusPill key={v} variant={v}>x</StatusPill>)}</>
    );
    assertNoBannedTokens(container);
  });

  it('CotMarker — all affiliations render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <CotMarker affiliation="friendly" />
        <CotMarker affiliation="hostile" />
        <CotMarker affiliation="neutral" />
        <CotMarker affiliation="unknown" />
      </>
    );
    assertNoBannedTokens(container);
  });

  it('Surface — all variants render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <Surface variant="canvas">canvas</Surface>
        <Surface variant="1">s1</Surface>
        <Surface variant="2">s2</Surface>
        <Surface variant="3">s3</Surface>
        <Surface variant="overlay">overlay</Surface>
      </>
    );
    assertNoBannedTokens(container);
  });

  it('Toggle — on and off render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <Toggle checked={false} onChange={() => {}} label="off" />
        <Toggle checked={true} onChange={() => {}} label="on" />
      </>
    );
    assertNoBannedTokens(container);
  });

  it('Input — text and textarea render without banned tokens in LD', () => {
    const { container } = renderInLd(
      <>
        <Input placeholder="text" />
        <Input multiline placeholder="area" />
        <Input error="oops" />
      </>
    );
    assertNoBannedTokens(container);
  });
});
