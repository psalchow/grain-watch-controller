import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WheatMark } from './WheatMark';
import { WHEATMARK_SHAPES } from './wheatmarkGeometry';

describe('WheatMark', () => {
  it('draws every shape from the shared geometry', () => {
    const { container } = render(<WheatMark />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 512 512');
    expect(svg?.querySelectorAll('rect, ellipse')).toHaveLength(
      WHEATMARK_SHAPES.length
    );
  });

  it('rotates a grain around its own centre', () => {
    const { container } = render(<WheatMark />);

    const grain = container.querySelector('ellipse[cx="206"][cy="214"]');
    expect(grain?.getAttribute('transform')).toBe('rotate(-32 206 214)');
  });

  it('leaves the upright grain unrotated', () => {
    const { container } = render(<WheatMark />);

    const grain = container.querySelector('ellipse[cx="256"][cy="152"]');
    expect(grain?.getAttribute('transform')).toBeNull();
  });

  it('takes its colour from the surrounding text colour', () => {
    const { container } = render(<WheatMark className="text-primary" />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('class')).toBe('text-primary');
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<WheatMark />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });
});
