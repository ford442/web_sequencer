import '@testing-library/jest-dom/vitest'

vi.mock('@/hooks/usePyodideEngine', () => ({
  usePyodideEngine: () => ({
    isPyodideLoading: false,
    isPythonLoading: false,
    pyodide: null,
    runPython: () => {},
  }),
}));

