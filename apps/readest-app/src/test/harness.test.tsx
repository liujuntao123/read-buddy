import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * Harness smoke test: proves .tsx component tests transform and render
 * correctly under vitest + happy-dom + @testing-library/react.
 */
function Hello({ name }: { name: string }) {
  return <p data-testid="hello">你好，{name}</p>;
}

describe('component test harness', () => {
  it('renders tsx with automatic jsx runtime', () => {
    render(<Hello name="readest-plus" />);
    expect(screen.getByTestId('hello').textContent).toBe('你好，readest-plus');
  });
});
