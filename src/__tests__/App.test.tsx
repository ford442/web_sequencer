import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';

describe('App', () => {
  it('renders ELECTRIBE heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/ELECTRIBE/i);
  });

  it('renders volume control', () => {
    render(<App />);
    expect(screen.getByText(/Vol/i)).toBeInTheDocument();
  });

  it('renders song step indicator', () => {
    render(<App />);
    expect(screen.getByText('Song', { selector: 'span' })).toBeInTheDocument();
  });
});
