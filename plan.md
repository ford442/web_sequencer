1.  **Objective**: Optimize `NoteSelector.tsx` to prevent inline arrow functions in event handlers from defeating `React.memo()`. The component has 34 inline callbacks mapping to range inputs and buttons.
2.  **Implementation**: Option A: We will implement stable property change handlers. However, `onChange={handlePropertyChange('timeStretchEnvDepth')}` creates a new closure anyway because it returns a new function. Actually, a `useCallback` that returns a function for a key means we would need to memoize the curried function or simply use a dataset attribute to avoid creating new functions. Like this:
    ```tsx
    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const key = e.target.dataset.property;
        if (key && onPropertyChange) {
            onPropertyChange(key as any, parseFloat(e.target.value));
        }
    }, [onPropertyChange]);
    ```
    And use it like:
    ```tsx
    <input data-property="timeStretchEnvDepth" onChange={handleSliderChange} ... />
    ```
    This completely removes the need for `PropertySlider` sub-components and correctly uses a single stable reference for all `onChange` handlers.
    We will do the same for `handleButtonToggle` and `handleSelectNote`.
3.  **Refactoring**: Search and replace the existing `<input type="range" />` elements and related inline callbacks in `NoteSelector.tsx` to use the new `data-property` and stable handlers.
4.  **Verification**: Verify the changes using `run_in_bash_session` to run tests matching `NoteSelector` component, e.g. `pnpm test NoteSelector`. Ensure it compiles and no syntax errors are introduced.
5.  **Tests**: Run the full test suite and linter using `pnpm test` and `pnpm lint` to ensure no regressions were introduced.
6.  **Pre-commit**: Complete pre-commit steps to make sure proper testing, verifications, reviews and reflections are done.
7.  **Submit**: Commit the changes.
