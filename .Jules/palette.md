## 2026-07-10 - Precise Accessibility Targeting
**Learning:** Broad regex replacements across JSX codebases to enforce accessibility properties (like `type="button"`) often cause immediate React syntax errors due to duplicated attributes across multi-line tags.
**Action:** Instead of cross-file regex scripts, use specific linter configurations (e.g., `eslint-plugin-react` rules) to find exact violations, and scope fixes to one or two high-impact components per PR to ensure stability and correctness.
