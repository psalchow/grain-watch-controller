import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}} title="Hidden">body</Dialog>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders title and children when open', () => {
    render(
      <Dialog open onClose={() => {}} title="My Dialog"><p>hello</p></Dialog>
    );
    expect(screen.getByText('My Dialog')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders into the document body, not the parent tree', () => {
    // A `backdrop-filter` ancestor (the sticky header) would otherwise become the
    // containing block for the fixed overlay and clip it to the header's box.
    const { container } = render(
      <div className="backdrop-blur">
        <Dialog open onClose={() => {}} title="Portalled">body</Dialog>
      </div>
    );

    expect(container).not.toContainElement(screen.getByText('Portalled'));
    expect(document.body).toContainElement(screen.getByText('Portalled'));
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="X">body</Dialog>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
